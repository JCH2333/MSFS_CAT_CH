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

// 热更拷贝到 couatl/GSX 目录时目标 .wav 等可能被杀毒软件扫描或残留进程占用：
  // EPERM/EACCES/EBUSY 短暂重试后再失败，翻译为可行动的中文指引（用户反馈 FB-6PWZXZ）。
  async function copyFileWithRetry(source, destination, attempts = 3) {
    let lastError = null
    for (let i = 0; i < attempts; i += 1) {
      try {
        await fs.copyFile(source, destination)
        return
      } catch (error) {
        lastError = error
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
        await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)))
      }
    }
    throw new Error(
      '更新失败：目标文件被占用或受保护（' + destination + '）。' +
      '请确认微软模拟飞行与 couatl 引擎已完全退出、关闭杀毒软件的"受控文件夹访问"，必要时以管理员身份运行本软件后重试。（' + (lastError.code || '未知') + '）'
    )
  }

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

// boot 更新器（couatl64_boot.exe）的引擎组件 ETag 记录，位于
// %APPDATA%\Virtuali\hotfix_etags.txt，每行 `URL=ETag`。引擎组件经官方
// Live Update 从零安装后不写 github-etags sidecar，只写这份文件——
// 把它作为第三条记录源可避免对这类机器的重复下载误报（2026-09 实测案例）。
function parseHotfixEtags(contents) {
  const map = {}
  const suffix = '.zip.001'
  for (const line of String(contents || '').split(/\r?\n/)) {
    const separator = line.lastIndexOf('=')
    if (separator <= 0) continue
    const url = line.slice(0, separator).trim()
    const etag = normalizeEtag(line.slice(separator + 1))
    if (!etag) continue
    const base = url.split('/').pop() || ''
    if (!base.endsWith(suffix)) continue
    map[base.slice(0, -suffix.length)] = etag
  }
  return map
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
    hotfixEtagsPath = null,
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
    this.hotfixEtagsPath = hotfixEtagsPath
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

  async computePending(packages, { localVersion = null, addonRoot = null } = {}) {
    const state = await readJsonState(this.statePath)
    const applied = state.appliedComponents || {}
    let hotfixEtags = {}
    if (this.hotfixEtagsPath) {
      try {
        hotfixEtags = parseHotfixEtags(await fs.readFile(this.hotfixEtagsPath, 'utf8'))
      } catch {
        hotfixEtags = {}
      }
    }
    const pending = []
    const packageVersions = new Map()
    for (const pkg of packages) {
      // 内容对账：部署目标在插件包内部的组件（textures 等），其真实内容随目标包版本走。
      // 目标包版本低于组件版本时，任何“已应用”记录都不可信——它们可能来自自部署
      // 之前的机器状态（官方下载器写入的 hotfix_etags 等），否则会出现 4.0.10 本体
      // 配 4.0.23 记录、更新按钮消失的假阴性。目标包缺失时维持记录判定（应用阶段会跳过）。
      if (pkg.deployTarget.startsWith('MSFS/') && addonRoot) {
        const targetPackage = pkg.deployTarget.split('/')[1]
        if (targetPackage && !packageVersions.has(targetPackage)) {
          const targetManifestPath = path.join(addonRoot, 'MSFS', targetPackage, GSX_PACKAGE_MANIFEST)
          const version = await fs.readFile(targetManifestPath, 'utf8')
            .then((contents) => {
              const parsed = JSON.parse(contents)
              const value = typeof parsed?.package_version === 'string' ? parsed.package_version
                : (typeof parsed?.packageVersion === 'string' ? parsed.packageVersion : null)
              return value && isSemanticVersion(value) ? value : null
            })
            .catch(() => null)
          packageVersions.set(targetPackage, version)
        }
        const targetVersion = packageVersions.get(targetPackage)
        if (targetVersion && compareVersions(targetVersion, pkg.version) < 0) {
          pending.push(pkg)
          continue
        }
      }
      const officialEtag = await readEtagSidecar(this.officialEtagDirectory, pkg.component)
      if (officialEtag && officialEtag === pkg.etag) continue
      const appliedEtag = normalizeEtag(applied[pkg.component]?.etag)
      if (appliedEtag === pkg.etag) continue
      const hotfixEtag = normalizeEtag(hotfixEtags[pkg.component])
      if (hotfixEtag && hotfixEtag === pkg.etag) continue
      pending.push(pkg)
    }
    return pending
  }

  /** 重置本地应用状态（产品被卸载/官方重装后，从干净状态重新对账） */
  async clearAppliedState() {
    const state = await readJsonState(this.statePath)
    state.appliedComponents = {}
    await writeJsonState(this.statePath, state)
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
    const pending = await this.computePending(manifest.packages, { localVersion: install.version, addonRoot: install.addonRoot })
    const localVersion = install.version
    let versionState = 'unknown'
    if (manifest.latestVersion && isSemanticVersion(localVersion)) {
      versionState = compareVersions(localVersion, manifest.latestVersion) >= 0 ? 'current' : 'older'
    }
    // 幽灵版本检测：manifest 版本落后于镜像源，但全部组件的 ETag 均已同步——
    // 版本标记（manifest.json）大概率被旧版补丁覆盖（2026-09 v1.2.8 事故），
    // 此时"已是最新"与版本徽章自相矛盾，界面需给出针对性指引而非静默。
    const versionMarkerStale = versionState === 'older' && pending.length === 0
    return {
      ...base,
      installed: true,
      addonRoot: install.addonRoot,
      packagePath: install.packagePath,
      localVersion,
      versionState,
      versionMarkerStale,
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
    // 跨大版本守卫：镜像热更只覆盖目标版本的组件文件，不清理旧版本残留文件。
    // 从 3.x 等老版本直接覆盖到 4.x 会留下混合安装（couatl 无法启动、游戏内面板
    // 连锁失效——反馈 #29/#30/#32）。跨大版本必须走官方完整安装。
    const mirror = await this.loadMirrorManifest()
    const localMajor = Number(String(install.version || '').split('.')[0])
    const targetMajor = Number(String(mirror.manifest.latestVersion || '').split('.')[0])
    if (Number.isFinite(localMajor) && Number.isFinite(targetMajor) && localMajor < targetMajor) {
      throw new Error(`本机 GSX（${install.version}）过旧，无法直接热更到 ${mirror.manifest.latestVersion}：跨大版本的覆盖式更新会留下混合安装。请先用官方 Universal Installer 完整安装或升级 GSX 到 ${mirror.manifest.latestVersion}，再使用本更新功能`)
    }
    const pending = await this.computePending(mirror.manifest.packages, { localVersion: install.version, addonRoot: install.addonRoot })
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
          await copyFileWithRetry(stagedFile, destination)
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

    // 版本标记提升：镜像热更不经过官方更新器，包 manifest 的 package_version 需要
    // 由本流程推进到镜像最新版——否则自部署（如 4.0.10 完整包）+ 热更后版本显示
    // 永远停留在旧版，更新入口也随之消失。
    if (applied.length > 0 && install.packagePath && mirror.manifest.latestVersion && isSemanticVersion(mirror.manifest.latestVersion)) {
      const packageManifestPath = path.join(install.packagePath, GSX_PACKAGE_MANIFEST)
      try {
        const parsed = JSON.parse(await fs.readFile(packageManifestPath, 'utf8'))
        const current = typeof parsed?.package_version === 'string' ? parsed.package_version : '0.0.0'
        if (isSemanticVersion(current) && compareVersions(current, mirror.manifest.latestVersion) < 0) {
          parsed.package_version = mirror.manifest.latestVersion
          await fs.writeFile(packageManifestPath, JSON.stringify(parsed, null, 2))
          this.emit({ phase: 'marker-bumped', percent: 100, message: `版本标记已更新到 v${mirror.manifest.latestVersion}` })
        }
      } catch {
        // 标记写不进去只影响版本显示，不影响已部署内容
      }
    }

    // 组件下载结束：让出排队带宽槽位（宽限期内原顺位恢复）
    await this.downloadImpl.releaseSession?.()
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
  parseHotfixEtags,
  validateGsxManifest
}
