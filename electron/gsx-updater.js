const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const extractZip = require('extract-zip')
const { buildServerUrl, isTrustedServerUrl } = require('./distribution-server')
const { downloadToFile, ensureWithin, sha256 } = require('./patch-installer')
const { compareVersions, isSemanticVersion } = require('./versioning')
const { registeredAddonManagerRoots } = require('./installation-targets')

const execFileAsync = promisify(execFile)

const GSX_MANIFEST_PATH = '/api/gsx/manifest.json'
const GSX_MANIFEST_URL = buildServerUrl(GSX_MANIFEST_PATH)
const GSX_MANIFEST_TIMEOUT_MS = 8000
const GSX_PACKAGE_FOLDER = 'fsdreamteam-gsx-pro'
const GSX_PACKAGE_MANIFEST = 'manifest.json'

// 更新期间必须关闭的进程：模拟器本体与 couatl 引擎会锁定 couatl64 与社区包文件。
const SIM_PROCESS_NAMES = [
  'FlightSimulator2024.exe',
  'FlightSimulator.exe',
  'couatl64_MSFS2024.exe',
  'couatl64_MSFS.exe',
  'couatl_MSFS2024.exe',
  'couatl_MSFS.exe'
]

const COMPONENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const ASSET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/
const DEPLOY_TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/

// 只随官方完整安装分发、镜像热更不覆盖的基础文件。缺失 = 基础安装过旧或损坏，
// 覆盖式更新无法补齐，应引导用户先用官方 Universal Installer 完整安装。
const BASE_PACKAGE_FILES = [
  'modules/fsdt-msfs-bridge.wasm',
  'InGamePanels/fsdreamteam-ingamepanels-gsx.spb'
]

function normalizeEtag(value) {
  return String(value || '').trim().replace(/^"+|"+$/g, '')
}

// 镜像清单按“不可信输入”对待：逐字段校验后才会进入下载/部署流程。
function validateGsxManifest(input) {
  if (!input || typeof input !== 'object') throw new Error('GSX 镜像清单格式错误')
  if (input.schemaVersion !== 1) throw new Error('GSX 镜像清单版本不受支持')
  if (!Array.isArray(input.packages)) throw new Error('GSX 镜像清单缺少 packages')
  if (input.latestVersion !== null && input.latestVersion !== undefined) {
    if (typeof input.latestVersion !== 'string' || !isSemanticVersion(input.latestVersion)) {
      throw new Error('GSX 镜像清单 latestVersion 无效')
    }
  }

  const seen = new Set()
  const packages = input.packages.map((pkg) => {
    if (!pkg || typeof pkg !== 'object') throw new Error('GSX 镜像组件格式错误')
    if (typeof pkg.component !== 'string' || !COMPONENT_PATTERN.test(pkg.component)) {
      throw new Error(`GSX 镜像组件名无效：${pkg.component}`)
    }
    if (seen.has(pkg.component)) throw new Error(`GSX 镜像组件重复：${pkg.component}`)
    seen.add(pkg.component)
    if (typeof pkg.version !== 'string' || !isSemanticVersion(pkg.version)) {
      throw new Error(`GSX 镜像组件版本无效：${pkg.component}`)
    }
    if (typeof pkg.etag !== 'string' || pkg.etag.length === 0 || pkg.etag.length > 64) {
      throw new Error(`GSX 镜像组件 ETag 无效：${pkg.component}`)
    }
    if (typeof pkg.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(pkg.sha256)) {
      throw new Error(`GSX 镜像组件 SHA-256 无效：${pkg.component}`)
    }
    if (!Number.isInteger(pkg.size) || pkg.size <= 0) {
      throw new Error(`GSX 镜像组件大小无效：${pkg.component}`)
    }
    if (typeof pkg.deployTarget !== 'string' || !DEPLOY_TARGET_PATTERN.test(pkg.deployTarget)
      || pkg.deployTarget.includes('..') || pkg.deployTarget.endsWith('/')) {
      throw new Error(`GSX 镜像组件部署目标无效：${pkg.component}`)
    }
    if (typeof pkg.assetName !== 'string' || !ASSET_PATTERN.test(pkg.assetName)) {
      throw new Error(`GSX 镜像组件文件名无效：${pkg.component}`)
    }
    if (typeof pkg.downloadUrl !== 'string' || !isTrustedServerUrl(pkg.downloadUrl)) {
      throw new Error(`GSX 镜像组件下载地址不受信任：${pkg.component}`)
    }
    return { ...pkg, etag: normalizeEtag(pkg.etag), sha256: pkg.sha256.toLowerCase() }
  })

  return {
    schemaVersion: 1,
    latestVersion: input.latestVersion || null,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : null,
    packages
  }
}

async function fetchGsxManifest({ fetchImpl = globalThis.fetch, manifestUrl = GSX_MANIFEST_URL, timeoutMs = GSX_MANIFEST_TIMEOUT_MS } = {}) {
  const response = await fetchImpl(`${manifestUrl}?t=${Date.now()}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'msfs-cat-ch' },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) throw new Error(`GSX 镜像清单请求失败：HTTP ${response.status}`)
  return validateGsxManifest(await response.json())
}

// 官方更新器（couatl64_boot.exe / Couatl_Updater2.exe）的 ETag 备忘，位于
// %APPDATA%\Virtuali\PackagesCache\github-etags\<组件>.zip.etag。它代表“官方内容
// 已经应用到本机”的事实，与本地应用状态一起用于判断组件是否需要更新。
function defaultOfficialEtagDirectory() {
  const appData = process.env.APPDATA
  return appData ? path.join(appData, 'Virtuali', 'PackagesCache', 'github-etags') : null
}

async function readEtagSidecar(etagDirectory, component) {
  if (!etagDirectory) return null
  try {
    const contents = await fs.readFile(path.join(etagDirectory, `${component}.zip.etag`), 'utf8')
    const normalized = normalizeEtag(contents)
    return normalized || null
  } catch {
    return null
  }
}

async function walkFiles(root) {
  const files = []
  const walk = async (current) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error('镜像包包含不允许的符号链接')
      if (entry.isDirectory()) {
        await walk(entryPath)
      } else if (entry.isFile()) {
        files.push(entryPath)
      }
    }
  }
  await walk(root)
  return files
}

async function defaultSimProcessLister() {
  const { stdout } = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
    windowsHide: true,
    timeout: 8000,
    maxBuffer: 1024 * 1024
  })
  return stdout
}

// GSX 安装检测：FSDT Addon Manager 根目录（注册表）+ 其 MSFS 社区包内的 manifest 版本。
async function defaultDetectInstall() {
  const roots = await registeredAddonManagerRoots()
  for (const root of roots) {
    const packageManifestPath = path.join(root.rootPath, 'MSFS', GSX_PACKAGE_FOLDER, GSX_PACKAGE_MANIFEST)
    try {
      const manifest = JSON.parse(await fs.readFile(packageManifestPath, 'utf8'))
      const version = typeof manifest.package_version === 'string'
        ? manifest.package_version
        : (typeof manifest.packageVersion === 'string' ? manifest.packageVersion : null)
      if (version) {
        return {
          installed: true,
          addonRoot: path.resolve(root.rootPath),
          packagePath: path.dirname(packageManifestPath),
          version,
          source: root.source
        }
      }
    } catch {
      // 该注册表根不是有效的 FSDT 安装，继续尝试下一个
    }
  }
  return { installed: false, addonRoot: null, packagePath: null, version: null, source: null }
}

async function readJsonState(statePath) {
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf8'))
  } catch {
    return {}
  }
}

async function writeJsonState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  const temporaryPath = `${statePath}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2))
  await fs.rename(temporaryPath, statePath)
}

/**
 * GSX 本体更新器：从自建分发服务器下载 FSDreamTeam 官方更新 ZIP（逐字节镜像）
 * 并按官方同款映射部署。安全模型与补丁一致——SHA-256 校验、安全解压、
 * 备份被覆盖文件、失败回滚、安装状态落盘。
 */
class GsxUpdater {
  constructor({
    userDataDirectory,
    onProgress = () => {},
    download = downloadToFile,
    fetchImpl = globalThis.fetch,
    detectInstall = defaultDetectInstall,
    processLister = defaultSimProcessLister,
    officialEtagDirectory = defaultOfficialEtagDirectory(),
    now = () => new Date().toISOString()
  } = {}) {
    if (!userDataDirectory) throw new Error('GsxUpdater 需要 userDataDirectory')
    this.userDataDirectory = userDataDirectory
    this.onProgress = onProgress
    this.downloadImpl = download
    this.fetchImpl = fetchImpl
    this.detectInstall = detectInstall
    this.processLister = processLister
    this.officialEtagDirectory = officialEtagDirectory
    this.now = now
    this.statePath = path.join(userDataDirectory, 'gsx-state.json')
    this.backupRoot = path.join(userDataDirectory, 'gsx-backups')
    this.cacheDirectory = path.join(userDataDirectory, 'cache')
    this.mirror = null
    this.busy = false
  }

  emit(payload) {
    this.onProgress(payload)
  }

  async loadMirrorManifest() {
    if (!this.mirror) {
      this.mirror = new GsxMirror({
        cacheDirectory: this.cacheDirectory,
        fetchImpl: this.fetchImpl
      })
    }
    const result = await this.mirror.refresh()
    return result
  }

  async computePending(packages) {
    const state = await readJsonState(this.statePath)
    const applied = state.appliedComponents || {}
    const pending = []
    for (const pkg of packages) {
      const officialEtag = await readEtagSidecar(this.officialEtagDirectory, pkg.component)
      if (officialEtag && officialEtag === pkg.etag) continue
      const appliedEtag = normalizeEtag(applied[pkg.component]?.etag)
      if (appliedEtag === pkg.etag) continue
      pending.push(pkg)
    }
    return pending
  }

  async getStatus() {
    const [install, mirror] = await Promise.all([this.detectInstall(), this.loadMirrorManifest()])
    const manifest = mirror.manifest
    const base = {
      source: mirror.source,
      stale: Boolean(mirror.stale),
      error: mirror.error ? String(mirror.error.message || mirror.error) : null,
      latestVersion: manifest.latestVersion,
      serverPackages: manifest.packages.length
    }
    if (!install.installed) {
      return { ...base, installed: false, updateAvailable: false, pending: [], localVersion: null }
    }
    const pending = await this.computePending(manifest.packages)
    const localVersion = install.version
    let versionState = 'unknown'
    if (manifest.latestVersion && isSemanticVersion(localVersion)) {
      versionState = compareVersions(localVersion, manifest.latestVersion) >= 0 ? 'current' : 'older'
    }
    return {
      ...base,
      installed: true,
      addonRoot: install.addonRoot,
      packagePath: install.packagePath,
      localVersion,
      versionState,
      pending: pending.map((pkg) => ({
        component: pkg.component,
        version: pkg.version,
        size: pkg.size,
        deployTarget: pkg.deployTarget
      })),
      totalBytes: pending.reduce((sum, pkg) => sum + pkg.size, 0),
      updateAvailable: pending.length > 0
    }
  }

  async assertSimClosed() {
    const listing = await this.processLister()
    const running = SIM_PROCESS_NAMES.filter((name) => listing.toLowerCase().includes(name.toLowerCase()))
    if (running.length > 0) {
      throw new Error(`检测到模拟器或 GSX 引擎正在运行（${running[0]}），请完全退出后重试更新`)
    }
  }

  async resolveTarget(addonRoot, deployTarget) {
    const relative = deployTarget.split('/')
    return ensureWithin(addonRoot, path.join(addonRoot, ...relative))
  }

  async applyUpdate() {
    if (this.busy) throw new Error('GSX 更新正在进行中')
    this.busy = true
    try {
      return await this.applyUpdateInner()
    } finally {
      this.busy = false
    }
  }

  async applyUpdateInner() {
    await this.assertSimClosed()
    const install = await this.detectInstall()
    if (!install.installed) throw new Error('未检测到 GSX 安装，无法更新')
    // 基础件守卫：wasm 桥与面板 spb 只随官方完整安装分发，镜像热更不覆盖它们。
    // 缺失说明基础安装过旧或损坏，覆盖式更新无法补齐，需先走官方完整安装。
    if (install.packagePath) {
      for (const fundamental of BASE_PACKAGE_FILES) {
        const exists = await fs.stat(path.join(install.packagePath, fundamental)).then((s) => s.isFile()).catch(() => false)
        if (!exists) {
          throw new Error(`GSX 基础安装不完整（缺少 ${fundamental}）。请先用官方 Universal Installer 完整安装或修复 GSX，再使用本更新功能`)
        }
      }
    }
    const mirror = await this.loadMirrorManifest()
    const pending = await this.computePending(mirror.manifest.packages)
    if (pending.length === 0) return { state: 'current', applied: [], skipped: [] }

    const state = await readJsonState(this.statePath)
    state.appliedComponents = state.appliedComponents || {}
    const applied = []
    const skipped = []
    const total = pending.length
    const totalBytes = pending.reduce((sum, pkg) => sum + pkg.size, 0)
    let completed = 0
    let bytesDone = 0

    // 总进度按字节加权：跨组件累计，下载阶段按已接收字节推进，校验/部署阶段视为该组件完成
    const emitOverall = (base, phase, componentFraction, message, extra = {}) => {
      const clamped = Math.min(1, Math.max(0, componentFraction))
      const received = Math.round(bytesDone + clamped * base.size)
      this.emit({
        ...base,
        phase,
        percent: totalBytes > 0 ? Math.min(100, Math.floor((received / totalBytes) * 100)) : 100,
        received,
        total: totalBytes,
        completed,
        totalComponents: total,
        message,
        ...extra
      })
    }

    for (const pkg of pending) {
      const base = { component: pkg.component, size: pkg.size }
      const indexLabel = `（${completed + 1}/${total}）`
      const targetPath = await this.resolveTarget(install.addonRoot, pkg.deployTarget)

      // 社区包组件要求目标插件包已安装（例如未购买 GSX World 时不存在该包）。
      // 直接解压会凭空创建残缺目录，必须跳过并如实上报。
      if (pkg.deployTarget.startsWith('MSFS/')) {
        const pkgManifestExists = await fs.stat(path.join(targetPath, 'manifest.json')).then((s) => s.isFile()).catch(() => false)
        if (!pkgManifestExists) {
          skipped.push({ component: pkg.component, reason: '未安装对应的插件包' })
          bytesDone += pkg.size
          completed += 1
          this.emit({
            ...base,
            phase: 'component-skipped',
            percent: totalBytes > 0 ? Math.min(100, Math.floor((bytesDone / totalBytes) * 100)) : 100,
            received: bytesDone,
            total: totalBytes,
            message: `${pkg.component} 跳过（${skipped[skipped.length - 1].reason}）`,
            completed,
            totalComponents: total
          })
          continue
        }
      }

      const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gsx-update-'))
      const journal = []
      try {
        const archivePath = path.join(stagingRoot, pkg.assetName)
        emitOverall(base, 'download', 0, `下载 ${pkg.component}${indexLabel}`)
        await this.downloadImpl(pkg.downloadUrl, archivePath, (progress) => {
          const fraction = progress.total ? progress.received / progress.total : 0
          emitOverall(base, 'download', fraction, `下载 ${pkg.component}${indexLabel}`)
        })

        emitOverall(base, 'verify', 1, `校验 ${pkg.component}${indexLabel}`)
        const actualSha256 = await sha256(archivePath)
        if (actualSha256 !== pkg.sha256) {
          throw new Error(`${pkg.component} 校验失败：SHA-256 与镜像清单不符`)
        }

        const extractDirectory = path.join(stagingRoot, 'extracted')
        await fs.mkdir(extractDirectory, { recursive: true })
        await extractZip(archivePath, { dir: extractDirectory })

        const backupDirectory = path.join(this.backupRoot, pkg.component, String(Date.now()))
        const stagedFiles = await walkFiles(extractDirectory)
        emitOverall(base, 'install', 1, `部署 ${pkg.component}${indexLabel}（${stagedFiles.length} 个文件）`)
        for (const stagedFile of stagedFiles) {
          const relativePath = path.relative(extractDirectory, stagedFile)
          if (path.isAbsolute(relativePath) || relativePath.startsWith('..')) {
            throw new Error(`镜像包包含越界路径：${pkg.component}/${relativePath}`)
          }
          const destination = ensureWithin(targetPath, path.join(targetPath, relativePath))
          await fs.mkdir(path.dirname(destination), { recursive: true })
          let backupPath = null
          try {
            const backupFilePath = path.join(backupDirectory, relativePath)
            await fs.mkdir(path.dirname(backupFilePath), { recursive: true })
            await fs.copyFile(destination, backupFilePath)
            backupPath = backupFilePath
          } catch {
            backupPath = null
          }
          await fs.copyFile(stagedFile, destination)
          journal.push({ destination, backupPath })
        }

        state.appliedComponents[pkg.component] = {
          etag: normalizeEtag(pkg.etag),
          version: pkg.version,
          appliedAt: this.now()
        }
        await writeJsonState(this.statePath, state)
        await this.writeOfficialSidecar(pkg.component, pkg.etag)
        applied.push({ component: pkg.component, version: pkg.version, files: journal.length })
        completed += 1
        bytesDone += pkg.size
        this.emit({
          ...base,
          phase: 'component-complete',
          percent: totalBytes > 0 ? Math.min(100, Math.floor((bytesDone / totalBytes) * 100)) : 100,
          received: bytesDone,
          total: totalBytes,
          message: `${pkg.component} 完成（${completed}/${total}）`,
          completed,
          totalComponents: total
        })
      } catch (error) {
        await this.rollback(journal)
        this.emit({
          ...base,
          phase: 'error',
          percent: 0,
          message: `更新失败：${error.message}`,
          error: error.message
        })
        throw error
      } finally {
        await fs.rm(stagingRoot, { recursive: true, force: true })
      }
    }

    this.emit({ phase: 'complete', percent: 100, received: totalBytes, total: totalBytes, applied, message: 'GSX 更新完成' })
    return { state: 'complete', applied, skipped }
  }

  async writeOfficialSidecar(component, etag) {
    // 官方更新器靠 sidecar ETag 跳过已应用内容；同步它可避免可直连 GitHub 的用户被重复下载。
    if (!this.officialEtagDirectory) return
    try {
      await fs.mkdir(this.officialEtagDirectory, { recursive: true })
      await fs.writeFile(path.join(this.officialEtagDirectory, `${component}.zip.etag`), normalizeEtag(etag))
    } catch {
      // 非关键路径：写不进去只影响官方更新器的去重，不影响本次更新结果
    }
  }

  async rollback(journal) {
    for (const entry of [...journal].reverse()) {
      try {
        if (entry.backupPath) {
          await fs.mkdir(path.dirname(entry.destination), { recursive: true })
          await fs.copyFile(entry.backupPath, entry.destination)
        } else {
          await fs.rm(entry.destination, { force: true })
        }
      } catch {
        // 回滚单文件失败时保留现场供手动恢复
      }
    }
  }
}

// 镜像清单客户端：服务器优先，失败回落本地缓存（与 Patch Catalog 同一套模式）。
class GsxMirror {
  constructor({ cacheDirectory, fetchImpl = globalThis.fetch, manifestUrl = GSX_MANIFEST_URL, timeoutMs = GSX_MANIFEST_TIMEOUT_MS }) {
    if (!cacheDirectory) throw new Error('GsxMirror 需要 cacheDirectory')
    this.cacheFile = path.join(cacheDirectory, 'gsx-manifest.json')
    this.fetchImpl = fetchImpl
    this.manifestUrl = manifestUrl
    this.timeoutMs = timeoutMs
  }

  async readCache() {
    try {
      return validateGsxManifest(JSON.parse(await fs.readFile(this.cacheFile, 'utf8')))
    } catch {
      return null
    }
  }

  async writeCache(manifest) {
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true })
    const temporaryPath = `${this.cacheFile}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify(manifest))
    await fs.rename(temporaryPath, this.cacheFile)
  }

  async refresh() {
    try {
      const manifest = await fetchGsxManifest({
        fetchImpl: this.fetchImpl,
        manifestUrl: this.manifestUrl,
        timeoutMs: this.timeoutMs
      })
      await this.writeCache(manifest)
      return { manifest, source: 'server', stale: false, error: null }
    } catch (error) {
      const cached = await this.readCache()
      if (cached) return { manifest: cached, source: 'cache', stale: true, error }
      throw error
    }
  }
}

module.exports = {
  GSX_MANIFEST_PATH,
  GSX_MANIFEST_URL,
  GSX_PACKAGE_FOLDER,
  SIM_PROCESS_NAMES,
  GsxMirror,
  GsxUpdater,
  fetchGsxManifest,
  normalizeEtag,
  validateGsxManifest
}
