const fs = require('node:fs/promises')
const nodeFs = require('node:fs')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const yauzl = require('yauzl')
const { buildServerUrl, isTrustedServerUrl } = require('./distribution-server')
const { downloadToFile, sha256, ensureWithin } = require('./patch-installer')
const { compareVersions, isSemanticVersion } = require('./versioning')

// GSX 全新安装的国内镜像客户端，与 gsx-updater.js 的热更镜像互补：
// 热更镜像解决“已装用户的版本推进”，本模块解决“全新安装”——
// 从分发服务器获取官方引导器（Universal Installer）与版本化完整包，
// 预置到官方 PackagesCache 后由官方安装器本地解压，不再从国外下载 5GB 本体。
//
// 镜像红线：经本模块下载的文件一律 SHA-256 校验后才落盘到位；
// PackagesCache 中已存在的同名官方完整包按“官方已交付”对待（见 ensurePackage），
// 绝不降级覆盖。

const GSX_INSTALL_MANIFEST_PATH = '/downloads/gsx/install-manifest.json'
const GSX_INSTALL_MANIFEST_URL = buildServerUrl(GSX_INSTALL_MANIFEST_PATH)
const GSX_INSTALL_MANIFEST_TIMEOUT_MS = 8000

// 预置下载之外保留的临时空间余量（解压 .part 与官方安装器自身的解包需要）
const DISK_SPACE_MARGIN_BYTES = 1024 * 1024 * 1024

// 自部署：解压目标为 Addon Manager\MSFS\<产品前缀>；两个模拟器槽位都要建链接的
// 产品 + 仅 2020 槽位的产品（与官方部署形态一致：woj-2020 本体存在但 2024 槽位无链接）
const DEPLOY_PRODUCT_PACKAGES = ['fsdreamteam-gsx-pro', 'fsdreamteam-gsx-world-of-jetways', 'fsdreamteam-gsx-efb']
const DEPLOY_PRODUCT_PACKAGES_2020 = ['fsdreamteam-gsx-world-of-jetways-2020']
const DEPLOY_TEMP_SUFFIX = '.deploying'

const ASSET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/
// 官方完整包命名：<product>-v<semver>.zip（如 fsdreamteam-gsx-pro-v4.0.10.zip）
const CACHE_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]*-v(\d+\.\d+\.\d+)\.zip$/
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/
const PACKAGE_ROLES = new Set(['product', 'extra'])

function validateBootstrap(input) {
  if (!input || typeof input !== 'object') throw new Error('安装引导器信息格式错误')
  if (typeof input.assetName !== 'string' || !ASSET_PATTERN.test(input.assetName)) {
    throw new Error('安装引导器文件名无效')
  }
  if (typeof input.sha256 !== 'string' || !SHA256_PATTERN.test(input.sha256)) {
    throw new Error('安装引导器 SHA-256 无效')
  }
  if (!Number.isInteger(input.size) || input.size <= 0) {
    throw new Error('安装引导器大小无效')
  }
  if (typeof input.downloadUrl !== 'string' || !isTrustedServerUrl(input.downloadUrl)) {
    throw new Error('安装引导器下载地址不受信任')
  }
  return {
    assetName: input.assetName,
    version: typeof input.version === 'string' ? input.version : null,
    sha256: input.sha256.toLowerCase(),
    size: input.size,
    downloadUrl: input.downloadUrl
  }
}

// 安装清单按“不可信输入”对待：逐字段校验后才会进入下载/预置流程。
function validateInstallManifest(input) {
  if (!input || typeof input !== 'object') throw new Error('GSX 安装清单格式错误')
  if (input.schemaVersion !== 1) throw new Error('GSX 安装清单版本不受支持')
  const bootstrap = validateBootstrap(input.bootstrap)

  if (!Array.isArray(input.packages) || input.packages.length === 0) {
    throw new Error('GSX 安装清单缺少 packages')
  }
  const seen = new Set()
  const packages = input.packages.map((pkg) => {
    if (!pkg || typeof pkg !== 'object') throw new Error('GSX 安装包格式错误')
    if (!PACKAGE_ROLES.has(pkg.role)) throw new Error(`GSX 安装包角色无效：${pkg.role}`)
    if (typeof pkg.cacheName !== 'string') throw new Error('GSX 安装包缓存名无效')
    const versionMatch = CACHE_NAME_PATTERN.exec(pkg.cacheName)
    if (!versionMatch) throw new Error(`GSX 安装包缓存名无效：${pkg.cacheName}`)
    if (seen.has(pkg.cacheName)) throw new Error(`GSX 安装包重复：${pkg.cacheName}`)
    seen.add(pkg.cacheName)
    if (typeof pkg.version !== 'string' || !isSemanticVersion(pkg.version)) {
      throw new Error(`GSX 安装包版本无效：${pkg.cacheName}`)
    }
    if (pkg.version !== versionMatch[1]) throw new Error(`GSX 安装包版本与缓存名不一致：${pkg.cacheName}`)
    if (typeof pkg.sha256 !== 'string' || !SHA256_PATTERN.test(pkg.sha256)) {
      throw new Error(`GSX 安装包 SHA-256 无效：${pkg.cacheName}`)
    }
    if (!Number.isInteger(pkg.size) || pkg.size <= 0) {
      throw new Error(`GSX 安装包大小无效：${pkg.cacheName}`)
    }
    if (typeof pkg.downloadUrl !== 'string' || !isTrustedServerUrl(pkg.downloadUrl)) {
      throw new Error(`GSX 安装包下载地址不受信任：${pkg.cacheName}`)
    }
    return {
      role: pkg.role,
      cacheName: pkg.cacheName,
      version: pkg.version,
      sha256: pkg.sha256.toLowerCase(),
      size: pkg.size,
      downloadUrl: pkg.downloadUrl
    }
  })

  return {
    schemaVersion: 1,
    bootstrap,
    packages,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : null
  }
}

async function fetchInstallManifest({ fetchImpl = globalThis.fetch, manifestUrl = GSX_INSTALL_MANIFEST_URL, timeoutMs = GSX_INSTALL_MANIFEST_TIMEOUT_MS } = {}) {
  const response = await fetchImpl(`${manifestUrl}?t=${Date.now()}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'msfs-cat-ch' },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) throw new Error(`GSX 安装清单请求失败：HTTP ${response.status}`)
  return validateInstallManifest(await response.json())
}

// 完整包在官方 PackagesCache 中的产品前缀：fsdreamteam-gsx-pro-v4.0.10.zip →
// fsdreamteam-gsx-pro。用于识别“官方已交付的更高版本”。
function productPrefixOf(cacheName) {
  const index = cacheName.indexOf('-v')
  return index > 0 ? cacheName.slice(0, index) : null
}

async function defaultStatFs(target) {
  return fs.statfs(target)
}

// 读取 zip 元数据（仅中央目录，秒级完成）：条目数与解压后总字节，
// 用于磁盘空间守卫与按字节加权的部署进度。
function summarizeZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (error, zipfile) => {
      if (error) return reject(new Error(`无法读取安装包 ${path.basename(zipPath)}：${error.message}`))
      let entries = 0
      let bytes = 0
      let settled = false
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        zipfile.close()
        fn(value)
      }
      zipfile.on('error', (e) => finish(reject, e))
      zipfile.on('entry', (entry) => {
        entries += 1
        bytes += entry.uncompressedSize
        zipfile.readEntry()
      })
      zipfile.on('end', () => finish(resolve, { entries, bytes }))
      zipfile.readEntry()
    })
  })
}

// zip 条目名 → 目标路径（不可信输入）：拒绝盘符/绝对路径/穿越，统一斜杠
function resolveZipEntryPath(destination, entryName) {
  const normalized = String(entryName).replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`安装包内检测到非法路径条目：${entryName}`)
  }
  const segments = normalized.split('/').filter((segment) => segment.length > 0 && segment !== '.')
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`安装包内检测到路径穿越条目：${entryName}`)
  }
  const resolved = path.resolve(destination, ...segments)
  return ensureWithin(destination, resolved)
}

// 带进度安全解压：先收集全部条目的隐含目录（部分 zip 的目录条目不规范，
// 文件条目可能先于目录条目出现），再逐条解压；进度按解压完成字节累计。
function extractZipArchive({ zipPath, destination, onProgress }) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (error, zipfile) => {
      if (error) return reject(new Error(`无法读取安装包 ${path.basename(zipPath)}：${error.message}`))
      const impliedDirectories = new Set([path.resolve(destination)])
      const fileEntries = []
      let settled = false
      let completedBytes = 0
      const fail = (e) => {
        if (settled) return
        settled = true
        zipfile.close()
        reject(e instanceof Error ? e : new Error(String(e)))
      }
      zipfile.on('error', fail)
      zipfile.on('entry', (entry) => {
        try {
          const isDirectory = entry.fileName.endsWith('/')
          const resolved = resolveZipEntryPath(destination, entry.fileName)
          if (isDirectory) {
            impliedDirectories.add(resolved)
          } else {
            fileEntries.push({ entry, resolved })
            let cursor = path.dirname(resolved)
            while (cursor.startsWith(path.resolve(destination))) {
              impliedDirectories.add(cursor)
              const parent = path.dirname(cursor)
              if (parent === cursor) break
              cursor = parent
            }
          }
          zipfile.readEntry()
        } catch (e) {
          fail(e)
        }
      })
      zipfile.on('end', async () => {
        try {
          for (const directory of impliedDirectories) {
            await fs.mkdir(directory, { recursive: true })
          }
          for (const { entry, resolved } of fileEntries) {
            await new Promise((entryDone, entryFail) => {
              zipfile.openReadStream(entry, (streamError, stream) => {
                if (streamError) return entryFail(streamError)
                const output = nodeFs.createWriteStream(resolved)
                output.on('error', entryFail)
                stream.on('error', entryFail)
                stream.on('end', () => {
                  completedBytes += entry.uncompressedSize
                  onProgress?.({ entriesDone: fileEntries.length, bytesDone: completedBytes })
                  entryDone()
                })
                stream.pipe(output)
              })
            })
          }
          if (settled) return
          settled = true
          zipfile.close()
          resolve({ entries: fileEntries.length, bytes: completedBytes })
        } catch (e) {
          fail(e)
        }
      })
      zipfile.readEntry()
    })
  })
}

function createGsxInstall({
  cacheDirectory,
  packagesCacheDirectory,
  onProgress = () => {},
  fetchImpl = globalThis.fetch,
  download = downloadToFile,
  hashFile = sha256,
  statFs = defaultStatFs,
  opener = null
} = {}) {
  if (!cacheDirectory) throw new Error('createGsxInstall 需要 cacheDirectory')
  if (!packagesCacheDirectory) throw new Error('createGsxInstall 需要 packagesCacheDirectory')
  let cachedManifest = null

  async function loadManifest({ force = false } = {}) {
    if (!force && cachedManifest) return { manifest: cachedManifest, source: 'memory', stale: false }
    try {
      const manifest = await fetchInstallManifest({ fetchImpl })
      cachedManifest = manifest
      return { manifest, source: 'server', stale: false, error: null }
    } catch (error) {
      if (cachedManifest) return { manifest: cachedManifest, source: 'memory', stale: true, error }
      throw error
    }
  }

  function emit(phase, payload) {
    onProgress({ kind: 'install', phase, ...payload })
  }

  // 官方引导器：下载（校验 SHA-256）到客户缓存目录后返回路径；已就绪时跳过下载。
  async function ensureBootstrap({ manifest: provided } = {}) {
    const { manifest } = provided ? { manifest: provided } : await loadManifest()
    const bootstrap = manifest.bootstrap
    await fs.mkdir(cacheDirectory, { recursive: true })
    const target = path.join(cacheDirectory, bootstrap.assetName)
    const resolved = path.resolve(target)
    if (!resolved.startsWith(`${path.resolve(cacheDirectory)}${path.sep}`)) {
      throw new Error(`检测到越界的引导器路径（${target}），已中止`)
    }

    if (await fileHasHash(resolved, bootstrap)) {
      return { filePath: resolved, downloaded: false }
    }

    let lastPercent = -1
    await download(bootstrap.downloadUrl, resolved, ({ received, total }) => {
      const percent = total ? Math.min(100, Math.floor((received / total) * 100)) : 0
      if (percent !== lastPercent) {
        lastPercent = percent
        emit('bootstrap-download', { percent, received, total, message: `正在下载官方安装器… ${percent}%` })
      }
    })
    // downloadToFile 仅保证字节落盘，完整性以清单 SHA-256 为准
    const actual = await hashFile(resolved)
    if (actual !== bootstrap.sha256) {
      await fs.rm(resolved, { force: true })
      throw new Error('官方安装器校验失败（SHA-256 不匹配），已删除下载文件，请重试')
    }
    return { filePath: resolved, downloaded: true }
  }

  async function openBootstrap(filePath) {
    if (!opener) throw new Error('当前环境无法打开安装器')
    const error = await opener(filePath)
    if (error) throw new Error(`安装器启动失败：${error}`)
  }

  // 目标文件已满足清单要求（存在、大小一致、SHA-256 一致）
  async function fileHasHash(filePath, expected) {
    const stats = await fs.stat(filePath).catch(() => null)
    if (!stats?.isFile() || stats.size !== expected.size) return false
    return (await hashFile(filePath)) === expected.sha256
  }

  // PackagesCache 中同名产品的更高版本完整包（官方已交付）——跳过预置，绝不降级。
  async function findNewerCachedVersion(pkg) {
    const prefix = productPrefixOf(pkg.cacheName)
    if (!prefix) return null
    const entries = await fs.readdir(packagesCacheDirectory).catch(() => [])
    for (const entry of entries) {
      if (!entry.startsWith(`${prefix}-v`)) continue
      const match = CACHE_NAME_PATTERN.exec(entry)
      if (match && compareVersions(match[1], pkg.version) > 0) return entry
    }
    return null
  }

  // 快速判定：完整包已在 PackagesCache（文件名 + 字节大小一致即视为官方已交付，
  // 不做全量哈希——6.9GB 哈希耗时数分钟且该文件本就来自官方通道；经本模块
  // 下载的文件在落盘前已做过 SHA-256 校验）。
  async function packageSeemsCached(pkg) {
    const stats = await fs.stat(path.join(packagesCacheDirectory, pkg.cacheName)).catch(() => null)
    return Boolean(stats?.isFile() && stats.size === pkg.size)
  }

  async function planPackages({ manifest: provided } = {}) {
    const { manifest } = provided ? { manifest: provided } : await loadManifest()
    const plan = []
    for (const pkg of manifest.packages) {
      const newer = await findNewerCachedVersion(pkg)
      if (newer) {
        plan.push({ pkg, action: 'skip', reason: `本地已有更高版本 ${newer}` })
        continue
      }
      if (await packageSeemsCached(pkg)) {
        plan.push({ pkg, action: 'skip', reason: '已预置' })
        continue
      }
      plan.push({ pkg, action: 'download', reason: null })
    }
    return { manifest, plan }
  }

  // 预置完整包：逐个下载到 PackagesCache（产物即官方安装器直接消费的缓存文件）。
  async function presetPackages() {
    const { manifest, plan } = await planPackages()
    const pending = plan.filter((item) => item.action === 'download')
    if (pending.length === 0) {
      await download.releaseSession?.()
      return { manifest, downloaded: [], skipped: plan.map((item) => item.pkg.cacheName) }
    }

    await fs.mkdir(packagesCacheDirectory, { recursive: true })
    const remainingBytes = pending.reduce((sum, item) => sum + item.pkg.size, 0)
    const usage = await statFs(packagesCacheDirectory)
    const availableBytes = Number(usage.bavail) * Number(usage.bsize)
    if (availableBytes < remainingBytes + DISK_SPACE_MARGIN_BYTES) {
      const needed = Math.ceil((remainingBytes + DISK_SPACE_MARGIN_BYTES) / 1024 / 1024 / 1024)
      const have = Math.floor(availableBytes / 1024 / 1024 / 1024)
      throw new Error(`磁盘空间不足：预置安装包还需约 ${needed} GB，目标盘剩余约 ${have} GB，请清理后重试`)
    }

    const downloaded = []
    let finishedBytes = 0
    for (const { pkg } of pending) {
      const target = path.join(packagesCacheDirectory, pkg.cacheName)
      const resolved = path.resolve(target)
      if (!resolved.startsWith(`${path.resolve(packagesCacheDirectory)}${path.sep}`)) {
        throw new Error(`检测到越界的缓存路径（${target}），已中止`)
      }
      let lastPercent = -1
      await download(pkg.downloadUrl, resolved, ({ received, total }) => {
        const overall = Math.min(100, Math.floor(((finishedBytes + received) / remainingBytes) * 100))
        if (overall !== lastPercent) {
          lastPercent = overall
          emit('package-download', {
            percent: overall,
            received: finishedBytes + received,
            total: remainingBytes,
            message: `正在预置 ${pkg.cacheName}… ${overall}%`
          })
        }
      })
      const actual = await hashFile(resolved)
      if (actual !== pkg.sha256) {
        await fs.rm(resolved, { force: true })
        throw new Error(`${pkg.cacheName} 校验失败（SHA-256 不匹配），已删除下载文件，请重试`)
      }
      finishedBytes += pkg.size
      downloaded.push(pkg.cacheName)
    }
    // 下载阶段结束：进入本地解压前主动让出带宽槽位（宽限期内原顺位恢复）
    await download.releaseSession?.()
    return {
      manifest,
      downloaded,
      skipped: plan.filter((item) => item.action === 'skip').map((item) => item.pkg.cacheName)
    }
  }

  // 自部署：把 PackagesCache 里的官方完整包解压到 Addon Manager\MSFS\<产品>
  // 并在模拟器社区目录创建链接——不依赖官方安装器。流程：先确保包已预置
  // （复用下载+SHA-256 校验），逐包“临时目录解压 → 校验 manifest → 原子改名”，
  // 最后按槽位建 junction。已部署的产品自动跳过。
  async function deployPackages({ addonRoot, communityTargets } = {}) {
    if (!addonRoot) throw new Error('未检测到 FSDT 安装根目录，无法部署')
    const { manifest } = await loadManifest()
    await presetPackages()

    const resolvedAddonRoot = path.resolve(addonRoot)
    const pending = []
    const skipped = []
    const deployed = []
    for (const pkg of manifest.packages) {
      const productName = productPrefixOf(pkg.cacheName)
      if (!productName) throw new Error(`安装包缓存名无法识别产品：${pkg.cacheName}`)
      const target = ensureWithin(resolvedAddonRoot, path.join(resolvedAddonRoot, 'MSFS', productName))
      const stats = await fs.stat(target).catch(() => null)
      if (stats?.isDirectory()) {
        const deployedManifest = await fs.readFile(path.join(target, 'manifest.json'), 'utf8').catch(() => null)
        if (deployedManifest) {
          skipped.push(productName)
          continue
        }
        // 空目录残留（旧版本卸载/中断遗留）：直接清理后照常部署，免去手动卸载步骤
        const leftoverEntries = await fs.readdir(target).catch(() => null)
        if (Array.isArray(leftoverEntries) && leftoverEntries.length === 0) {
          await fs.rmdir(target)
        } else {
          throw new Error(`部署目标已存在但不完整（${target}）。若确认是旧版本残留且无重要文件，可手动删除该文件夹后重试`)
        }
      }
      pending.push({ pkg, productName, target })
    }

    if (pending.length > 0) {
      const summaries = []
      let totalBytes = 0
      for (const item of pending) {
        const source = path.join(packagesCacheDirectory, item.pkg.cacheName)
        const summary = await summarizeZip(source)
        summaries.push(summary)
        totalBytes += summary.bytes
      }
      const usage = await statFs(resolvedAddonRoot)
      const availableBytes = Number(usage.bavail) * Number(usage.bsize)
      if (availableBytes < totalBytes + DISK_SPACE_MARGIN_BYTES) {
        const needed = Math.ceil((totalBytes + DISK_SPACE_MARGIN_BYTES) / 1024 / 1024 / 1024)
        const have = Math.floor(availableBytes / 1024 / 1024 / 1024)
        throw new Error(`磁盘空间不足：部署完整包还需约 ${needed} GB，目标盘剩余约 ${have} GB，请清理后重试`)
      }

      let finishedBytes = 0
      for (let index = 0; index < pending.length; index += 1) {
        const { pkg, productName, target } = pending[index]
        const source = path.join(packagesCacheDirectory, pkg.cacheName)
        const temporary = path.join(path.dirname(target), `${path.basename(target)}${DEPLOY_TEMP_SUFFIX}`)
        await fs.rm(temporary, { recursive: true, force: true })
        try {
          let lastPercent = -1
          await extractZipArchive({
            zipPath: source,
            destination: temporary,
            onProgress: ({ bytesDone }) => {
              const overall = totalBytes > 0
                ? Math.min(100, Math.floor(((finishedBytes + bytesDone) / totalBytes) * 100))
                : 0
              if (overall !== lastPercent) {
                lastPercent = overall
                emit('deploy', { percent: overall, received: finishedBytes + bytesDone, total: totalBytes, message: `正在部署 ${pkg.cacheName}… ${overall}%` })
              }
            }
          })
          const deployedManifest = JSON.parse(await fs.readFile(path.join(temporary, 'manifest.json'), 'utf8'))
          const deployedVersion = typeof deployedManifest?.package_version === 'string'
            ? deployedManifest.package_version
            : (typeof deployedManifest?.packageVersion === 'string' ? deployedManifest.packageVersion : null)
          if (deployedVersion !== pkg.version) {
            throw new Error(`${pkg.cacheName} 部署后校验失败（manifest 版本 ${deployedVersion || '缺失'} ≠ ${pkg.version}）`)
          }
          await fs.rename(temporary, target)
        } catch (error) {
          await fs.rm(temporary, { recursive: true, force: true }).catch(() => {})
          throw error
        }
        finishedBytes += summaries[index].bytes
        deployed.push(productName)
      }
    }

    const linked = []
    const linksSkipped = []
    for (const target of communityTargets || []) {
      const slot = target.slot === 'msfs2020' ? 'msfs2020' : 'msfs2024'
      const products = slot === 'msfs2020'
        ? [...DEPLOY_PRODUCT_PACKAGES, ...DEPLOY_PRODUCT_PACKAGES_2020]
        : DEPLOY_PRODUCT_PACKAGES
      for (const productName of products) {
        const source = path.join(resolvedAddonRoot, 'MSFS', productName)
        if (!(await fs.stat(source).then((s) => s.isDirectory()).catch(() => false))) continue
        const linkPath = ensureWithin(path.resolve(target.directory), path.join(target.directory, productName))
        const existing = await fs.lstat(linkPath).catch(() => null)
        if (existing) {
          linksSkipped.push(linkPath)
          continue
        }
        await fs.symlink(source, linkPath, 'junction')
        linked.push(linkPath)
      }
    }

    return { deployed, skipped, linked, linksSkipped }
  }

  return {
    loadManifest,
    ensureBootstrap,
    openBootstrap,
    planPackages,
    presetPackages,
    deployPackages
  }
}

module.exports = {
  DEPLOY_PRODUCT_PACKAGES,
  DEPLOY_PRODUCT_PACKAGES_2020,
  DEPLOY_TEMP_SUFFIX,
  DISK_SPACE_MARGIN_BYTES,
  GSX_INSTALL_MANIFEST_PATH,
  GSX_INSTALL_MANIFEST_URL,
  createGsxInstall,
  extractZipArchive,
  fetchInstallManifest,
  productPrefixOf,
  resolveZipEntryPath,
  summarizeZip,
  validateInstallManifest
}
