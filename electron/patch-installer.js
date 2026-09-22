const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')
const extractZip = require('extract-zip')
const { SERVER_HOSTNAME, buildServerUrl, serverOriginProtocol } = require('./distribution-server')
const { compareVersions, isSemanticVersion } = require('./versioning')

const ALLOWED_DOWNLOAD_HOSTS = new Set([SERVER_HOSTNAME])
const INSTALL_PLAN_TARGETS = new Set(['primary', 'gsx-runtime-res'])
const INSTALL_SLOT_PATTERN = /^[a-z0-9][a-z0-9-]{0,20}$/
const SERVER_PATCH_DOWNLOAD_PATH = '/api/patches/download/'

// 读取社区包 manifest 的 package_version（兼容 packageVersion 别名）；缺失或非法返回 null
async function readPackageVersion(file) {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'))
    const version = typeof parsed.package_version === 'string'
      ? parsed.package_version
      : (typeof parsed.packageVersion === 'string' ? parsed.packageVersion : null)
    return version && isSemanticVersion(version) ? version : null
  } catch {
    return null
  }
}

// 版本标记守卫：磁盘 manifest 比补丁捆绑的更新时跳过覆盖，防止旧补丁把插件版本
// 标记倒退（2026-09 "幽灵 4.0.21" 事故：v1.2.8 在 GSX 4.0.23 上覆盖 manifest，
// 客户端误报 GSX 4.0.21，更新页与补丁页互相死锁）。读不到或版本不可比时不拦截，
// 维持既有行为。
async function shouldSkipOlderManifestOverlay(sourceFile, destination) {
  try {
    const [incoming, onDisk] = await Promise.all([
      readPackageVersion(sourceFile),
      readPackageVersion(destination)
    ])
    if (!incoming || !onDisk) return false
    return compareVersions(onDisk, incoming) > 0
  } catch {
    return false
  }
}

// 安装目标列表归一化：兼容旧的单路径字符串与新的 [{slot, path}] 双版本形式；
// 同一路径只保留首次出现的槽位，避免重复写入同一目录
function normalizeInstallTargets(targetPaths) {
  const list = Array.isArray(targetPaths) ? targetPaths : [targetPaths]
  const normalized = []
  const seen = new Set()
  for (const entry of list) {
    const raw = typeof entry === 'string' ? entry : entry?.path
    if (typeof raw !== 'string' || !raw.trim()) continue
    const slot = typeof entry === 'object' && typeof entry?.slot === 'string' && INSTALL_SLOT_PATTERN.test(entry.slot)
      ? entry.slot.toLowerCase()
      : null
    const resolved = path.resolve(raw.trim())
    const key = resolved.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({ slot, targetPath: resolved })
  }
  return normalized
}

// 对账目标归一化：字符串 / [{slot,path}] 数组 / {msfs2024: path, msfs2020: path} 对象
function normalizeReconcileTargetPaths(value) {
  if (!value) return []
  if (typeof value === 'string') return [{ slot: null, targetPath: value }]
  if (Array.isArray(value)) return normalizeInstallTargets(value)
  if (typeof value !== 'object') return []
  return Object.entries(value)
    .filter(([slot, raw]) => typeof slot === 'string' && INSTALL_SLOT_PATTERN.test(slot) && typeof raw === 'string' && raw.trim())
    .map(([slot, raw]) => ({ slot: slot.toLowerCase(), targetPath: path.resolve(raw.trim()) }))
}

function isMultiSimPatch(patch) {
  return Boolean(patch?.dualSim)
}

function ensureSafeId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(value)) {
    throw new Error('补丁 ID 无效')
  }
  return value
}

function ensureWithin(root, candidate) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`检测到越界路径：${candidate}`)
  }
  return resolvedCandidate
}

// 权限受限（EPERM/EACCES）翻译：GSX 常被官方安装器装进 C:\Program Files (x86) 等
// 受系统保护的位置，普通权限运行本应用时写目标会直接被拒。把裸异常换成可操作的
// 中文指引（以管理员身份运行），避免用户面对一屏 EPERM。
function translateWriteError(error, destination) {
  if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
    const hint = '若 GSX 安装在 C:\\Program Files 等受保护位置，请右键本软件选择"以管理员身份运行"后再安装补丁；' +
      '若已关闭模拟器仍出现此提示，请检查杀毒软件的"受控文件夹访问"设置。'
    return new Error('安装失败：目标目录受 Windows 系统保护或被占用（' + destination + '）。' + hint + '（' + error.code + '）')
  }
  return error
}

function normalizeContentRoot(value) {
  if (!value) return ''
  const normalized = path.normalize(value)
  if (path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error('package.contentRoot 路径无效')
  }
  return normalized
}

async function validateInstallationTarget(patch, target) {
  if (patch?.targetKind === 'gsx-audio') {
    const soundsDirectory = ensureWithin(target, path.join(target, 'sounds'))
    const soundsStats = await fsp.stat(soundsDirectory).catch(() => null)
    if (!soundsStats?.isDirectory()) {
      throw new Error('GSX 中文语音包必须安装到 Addon Manager\\couatl\\GSX 目录，其中应包含 sounds 文件夹')
    }
    return
  }

  // 多模拟器补丁：目标即社区根目录本身（补丁包目录前缀在 ZIP 内），
  // 不校验机模目录；目录存在性由调用方保证
  if (isMultiSimPatch(patch)) {
    const entries = await fsp.readdir(target, { withFileTypes: true }).catch(() => null)
    if (!entries) {
      throw new Error(`安装目录不存在或不可访问：${target}`)
    }
  }
}

/**
 * 注入式补丁：不解压到社区根目录，而是把 contentRoot 内容直接写进机模包目录
 * （检测与手选的安装目标即机模包本身，targetFolders[0] = 机模包目录名，
 * 如 fycyc-aircraft-c919x），并同步机模包自己的 layout.json。
 * 约定 ZIP 内文件位于 contentRoot（通常 files/）之下，其余条目（注入/还原脚本等）不安装。
 */
function isInjectivePatch(patch) {
  return patch?.targetKind === 'addon-inject'
}

function normalizeInstallPlan(patch) {
  const configured = patch?.package?.installPlan
  if (!Array.isArray(configured) || configured.length === 0) {
    return [{ target: 'primary', contentRoot: normalizeContentRoot(patch?.package?.contentRoot) }]
  }
  if (isInjectivePatch(patch)) {
    // 注入式补丁必须显式声明 contentRoot：没有它，ZIP 根的注入/还原脚本会被
    // 当作补丁内容一起写进机模包
    if (configured.length !== 1 || configured[0]?.target !== 'primary') {
      throw new Error('注入式补丁的安装计划必须是单目标 primary')
    }
    const contentRoot = normalizeContentRoot(configured[0]?.contentRoot)
    if (!contentRoot) {
      throw new Error('注入式补丁必须声明 package.installPlan 的 contentRoot（如 files）')
    }
    return [{ target: 'primary', contentRoot }]
  }
  if (patch?.targetKind !== 'gsx-combined') {
    throw new Error('只有 GSX 总补丁可以使用多目标安装计划')
  }
  const targets = new Set()
  const plan = configured.map((entry, index) => {
    const target = typeof entry?.target === 'string' ? entry.target.trim() : ''
    const contentRoot = normalizeContentRoot(entry?.contentRoot)
    if (!INSTALL_PLAN_TARGETS.has(target) || targets.has(target) || !contentRoot) {
      throw new Error(`补丁安装计划无效：第 ${index + 1} 项`)
    }
    targets.add(target)
    return { target, contentRoot }
  })
  if (plan.length !== 2 || !targets.has('primary') || !targets.has('gsx-runtime-res')) {
    throw new Error('GSX 总补丁必须包含 Community 与 GSX 图片两个安装目标')
  }
  return plan
}

function backupRelativePath(target, relativePath, slot = null) {
  // 双版本补丁同一文件会写入多个模拟器目录，备份按槽位隔离避免互相覆盖
  if (slot) return path.join('slots', slot, relativePath)
  return target === 'primary' ? relativePath : path.join('targets', target, relativePath)
}

function fingerprintFiles(patch) {
  return Array.isArray(patch?.fingerprint)
    ? patch.fingerprint.filter((file) => (
      file
      && typeof file.relativePath === 'string'
      && typeof file.sha256 === 'string'
      && /^[a-f0-9]{64}$/.test(file.sha256)
    )).map((file) => ({
      target: typeof file.target === 'string' ? file.target : 'primary',
      relativePath: file.relativePath,
      sha256: file.sha256
    })).filter((file) => INSTALL_PLAN_TARGETS.has(file.target))
    : []
}

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

const WINDOWS_FILETIME_EPOCH_NS = 116444736000000000n

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function currentWindowsFileTime(filePath) {
  const stats = await fsp.stat(filePath, { bigint: true })
  return (stats.mtimeNs / 100n + WINDOWS_FILETIME_EPOCH_NS).toString()
}

function windowsFileTimeToSeconds(fileTime) {
  return Number(BigInt(fileTime) - WINDOWS_FILETIME_EPOCH_NS) / 10000000
}

function replaceLayoutDate(layoutText, relativePath, fileTime) {
  const escapedPath = escapeRegExp(relativePath.replace(/\\/g, '/'))
  const entryPattern = new RegExp(
    `(\\"path\\"\\s*:\\s*\\"${escapedPath}\\"\\s*,\\s*\\"size\\"\\s*:\\s*\\d+\\s*,\\s*\\"date\\"\\s*:\\s*)\\d+`,
    'i'
  )
  return layoutText.replace(entryPattern, `$1${fileTime}`)
}

function nowWindowsFileTime() {
  return (BigInt(Date.now()) * 10000n + 116444736000000000n).toString()
}

/**
 * 注入式补丁专用：把刚写入机模包的文件同步进机模包自己的 layout.json——
 * 已登记的条目更新 size 与 date，未登记的（本次新增文件）在 content 数组头部插入。
 * 机模厂商的登记串大小写与缩进风格不一，正则按宽松空白匹配、插入条目用 4/6 空格缩进。
 * 只改内存文本由调用方负责写盘与备份。
 */
function synchronizeVendorLayoutEntries(layoutText, installedFiles) {
  let text = layoutText
  const missing = []
  for (const file of installedFiles) {
    const escapedPath = escapeRegExp(file.relativePath.replace(/\\/g, '/'))
    const pattern = new RegExp(
      `("path"\\s*:\\s*"${escapedPath}"\\s*,\\s*"size"\\s*:\\s*)\\d+(\\s*,\\s*"date"\\s*:\\s*)\\d+`,
      'i'
    )
    if (pattern.test(text)) {
      text = text.replace(pattern, (_match, prefix, middle) => `${prefix}${file.size}${middle}${nowWindowsFileTime()}`)
    } else {
      missing.push(file)
    }
  }
  if (missing.length > 0) {
    const anchor = text.indexOf('"content"')
    if (anchor < 0) return text
    const insertAt = text.indexOf('{', anchor)
    if (insertAt < 0) return text
    const date = nowWindowsFileTime()
    const newEntries = missing
      .map((file) => `    {\n      "path": "${file.relativePath.replace(/\\/g, '/')}",\n      "size": ${file.size},\n      "date": ${date}\n    },`)
      .join('\n')
    text = text.slice(0, insertAt) + newEntries + '\n' + text.slice(insertAt)
  }
  return text
}

async function synchronizeInstalledLayoutDates(target, files) {
  const layoutPath = path.join(target, 'layout.json')
  const layoutStats = await fsp.stat(layoutPath).catch(() => null)
  if (!layoutStats?.isFile()) return false

  let layoutText = await fsp.readFile(layoutPath, 'utf8')
  let changed = false
  for (const file of files) {
    if (file.relativePath.toLowerCase() === 'layout.json') continue
    const destination = ensureWithin(target, path.join(target, file.relativePath))
    const fileTime = await currentWindowsFileTime(destination)
    const updated = replaceLayoutDate(layoutText, file.relativePath, fileTime)
    if (updated !== layoutText) {
      layoutText = updated
      changed = true
    }
  }

  if (changed) await fsp.writeFile(layoutPath, layoutText, 'utf8')

  // ChasePlane validates the layout entry for layout.json itself as well as
  // the files listed by the patch. Writing the layout changes its mtime, so
  // update that self-entry and then pin the final mtime to the value stored
  // in the file.
  const layoutEntry = layoutText.match(/"path"\s*:\s*"layout\.json"\s*,\s*"size"\s*:\s*\d+\s*,\s*"date"\s*:\s*(\d+)/i)
  if (layoutEntry) {
    const beforeFinalWrite = await currentWindowsFileTime(layoutPath)
    const withSelfDate = replaceLayoutDate(layoutText, 'layout.json', beforeFinalWrite)
    if (withSelfDate !== layoutText) {
      await fsp.writeFile(layoutPath, withSelfDate, 'utf8')
      const finalFileTime = await currentWindowsFileTime(layoutPath)
      const stableFileTime = (BigInt(finalFileTime) / 10000n * 10000n).toString()
      const pinnedLayout = replaceLayoutDate(withSelfDate, 'layout.json', stableFileTime)
      if (pinnedLayout !== withSelfDate) {
        await fsp.writeFile(layoutPath, pinnedLayout, 'utf8')
        const pinnedTime = windowsFileTimeToSeconds(stableFileTime)
        await fsp.utimes(layoutPath, pinnedTime, pinnedTime)
      }
      changed = true
    }
  }
  return changed
}

async function walkFiles(root) {
  const result = []
  async function visit(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      const stats = await fsp.lstat(fullPath)
      if (stats.isSymbolicLink()) {
        throw new Error(`补丁包包含不允许的符号链接：${entry.name}`)
      }
      if (stats.isDirectory()) {
        await visit(fullPath)
      } else if (stats.isFile()) {
        result.push(fullPath)
      }
    }
  }
  await visit(root)
  return result
}

const PROTECTED_PATCH_FILES = {
  'fsrealistic-plus-zh-cn': new Set([
    'html_ui/ingamepanels/fsrealistic/fsrealistic.js',
    'html_ui/ingamepanels/fsrealistic/port.js',
    'manifest.json'
  ]),
  'chaseplane-zh-cn': new Set([
    'html_ui/ingamepanels/p42chaseplane/p42chaseplane.js',
    'html_ui/ingamepanels/p42chaseplane/p42chaseplane_overlay.js',
    'html_ui/ingamepanels/p42chaseplane/p42chaseplane_worker.js',
    'modules/chaseplanemodule.wasm',
  ])
}

const PATCH_METADATA_FILES = new Set([
  'layout.json',
  'manifest.json'
])

const UNSUPPORTED_PATCH_IDS = new Set([
  // FSR+ restores its panel HTML during startup, removing any external
  // localization loader before the panel can use it.
  'fsrealistic-plus-zh-cn',
  // ChasePlane's Bridge validates its vendor package before loading the
  // panel. Until an official extension point exists, changing any file in
  // the vendor package makes the add-on unusable.
  'chaseplane-zh-cn'
])

function normalizedRelativePath(value) {
  return value.replace(/\\/g, '/').toLowerCase()
}

function validatePatchFiles(patchId, relativePaths) {
  if (patchId === 'fsrealistic-plus-zh-cn') {
    throw new Error('FSRealistic+ 汉化暂不可安装：官方组件会恢复被修改的插件核心文件')
  }
  if (patchId === 'chaseplane-zh-cn') {
    throw new Error('ChasePlane 汉化暂不可安装：官方 Bridge 会拒绝被修改的插件核心文件')
  }
  const protectedFiles = PROTECTED_PATCH_FILES[patchId]
  if (!protectedFiles) return

  const blocked = relativePaths
    .map(normalizedRelativePath)
    .filter((relativePath) => protectedFiles.has(relativePath))

  if (blocked.length > 0) {
    throw new Error(`补丁 ${patchId} 不允许覆盖插件核心文件：${blocked.join('、')}`)
  }
}

function validatePatchLayoutEntries(sourceFiles, contentRoot) {
  const layoutFile = sourceFiles.find((file) => normalizedRelativePath(path.relative(contentRoot, file)) === 'layout.json')
  if (!layoutFile) return

  let layout
  try {
    layout = JSON.parse(fs.readFileSync(layoutFile, 'utf8'))
  } catch {
    throw new Error('补丁 layout.json 不是有效 JSON')
  }
  if (!Array.isArray(layout?.content)) {
    throw new Error('补丁 layout.json 缺少 content 数组')
  }

  const entries = new Map(
    layout.content
      .filter((entry) => typeof entry?.path === 'string')
      .map((entry) => [normalizedRelativePath(entry.path), entry])
  )
  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(contentRoot, sourceFile)
    if (PATCH_METADATA_FILES.has(normalizedRelativePath(relativePath))) continue
    const entry = entries.get(normalizedRelativePath(relativePath))
    if (!entry) {
      throw new Error(`补丁 layout.json 缺少文件条目：${relativePath}`)
    }
    if (Number.isFinite(entry.size) && entry.size !== fs.statSync(sourceFile).size) {
      throw new Error(`补丁 layout.json 文件大小不匹配：${relativePath}`)
    }
  }
}

function serverPatchDownloadUrl(patchId) {
  return buildServerUrl(`${SERVER_PATCH_DOWNLOAD_PATH}${encodeURIComponent(patchId)}`)
}

function isAllowedDownloadUrl(input) {
  const url = new URL(input)
  // 过渡期允许配置源对应的协议（IP+端口联调时为 http），主机始终只认分发服务器
  return url.protocol === serverOriginProtocol() && ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)
}

async function downloadToFile(url, destination, onProgress, redirectsRemaining = 6) {
  if (!isAllowedDownloadUrl(url)) {
    throw new Error('补丁下载地址不是受信任的云端服务器地址')
  }

  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const temporaryPath = `${destination}.part`

  return new Promise((resolve, reject) => {
    // 过渡期 IP 源为 http，正式域名源为 https：按 URL 协议选择请求模块
    const transport = url.protocol === 'https:' ? https : require('node:http')
    const request = transport.get(url, { headers: { 'User-Agent': 'msfs-cat-ch' } }, (response) => {
      const status = response.statusCode || 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirectsRemaining <= 0) {
          reject(new Error('补丁下载重定向次数过多'))
          return
        }
        const nextUrl = new URL(response.headers.location, url).toString()
        downloadToFile(nextUrl, destination, onProgress, redirectsRemaining - 1).then(resolve, reject)
        return
      }
      if (status !== 200) {
        response.resume()
        reject(new Error(`补丁下载失败：HTTP ${status}`))
        return
      }

      const total = Number(response.headers['content-length'] || 0)
      let received = 0
      const output = fs.createWriteStream(temporaryPath)
      response.on('data', (chunk) => {
        received += chunk.length
        onProgress?.({ phase: 'download', received, total })
      })
      response.on('error', reject)
      output.on('error', reject)
      output.on('close', async () => {
        try {
          await fsp.rename(temporaryPath, destination)
          resolve(destination)
        } catch (error) {
          reject(error)
        }
      })
      response.pipe(output)
    })
    request.setTimeout(30000, () => {
      const error = new Error('补丁下载超时')
      error.code = 'ETIMEDOUT'
      request.destroy(error)
    })
    request.on('error', reject)
  }).catch(async (error) => {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  })
}

class PatchInstaller {
  constructor({ userDataDirectory, onProgress = () => {}, download = downloadToFile, resolveAdditionalTarget = null }) {
    this.userDataDirectory = userDataDirectory
    this.statePath = path.join(userDataDirectory, 'installations.json')
    this.backupRoot = path.join(userDataDirectory, 'backups')
    this.onProgress = onProgress
    this.download = download
    this.resolveAdditionalTarget = resolveAdditionalTarget
  }

  async readState() {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.statePath, 'utf8'))
      return parsed && typeof parsed === 'object' && parsed.installations
        ? parsed
        : { schemaVersion: 1, installations: {} }
    } catch {
      return { schemaVersion: 1, installations: {} }
    }
  }

  async writeState(state) {
    await fsp.mkdir(this.userDataDirectory, { recursive: true })
    const temporaryPath = `${this.statePath}.tmp`
    await fsp.writeFile(temporaryPath, JSON.stringify(state, null, 2), 'utf8')
    await fsp.rename(temporaryPath, this.statePath)
  }

  async listInstallations() {
    return (await this.readState()).installations
  }

  /** 移除指定补丁的安装记录（产品被卸载时记录随之失效，重装后从干净状态开始） */
  async forgetInstallations(patchIds) {
    const state = await this.readState()
    let removed = 0
    for (const patchId of patchIds || []) {
      if (state.installations && state.installations[patchId]) {
        delete state.installations[patchId]
        removed += 1
      }
    }
    if (removed > 0) await this.writeState(state)
    return removed
  }

  /**
   * 重装前置卸载（2.3.1）：一键安装/升级新版本前，把该补丁的旧安装先卸载干净。
   * - 托管安装且校验完好 → 走精确回滚 restore()（原文件从备份还原、补丁文件删除）；
   * - 其余情况（托管但文件缺失/被改动、detected 识别安装）→ 尽力而为：仍然从备份
   *   还原原文件，补丁引入的文件仅在哈希与安装记录一致时删除，被用户改过的保留；
   * - 最后清理因删除产生的空目录（直至安装目标根为止）并移除旧安装记录。
   * 目的：补丁包目录改名（如 zzz-* → zzz-JCH-*）或文件增删后，社区目录里不能残留
   * 旧版本文件或空目录——残留目录会按字母序参与 MSFS 覆盖排序，旧目录可能压住新版本。
   */
  async uninstallForReinstall(patchIdInput) {
    const patchId = ensureSafeId(patchIdInput)
    const state = await this.readState()
    const installation = state.installations[patchId]
    if (!installation) {
      return { mode: 'absent', removed: 0, restored: 0, quarantined: 0, keptModified: [], prunedDirectories: 0 }
    }

    const locations = (Array.isArray(installation.files) ? installation.files : [])
      .map((file) => ({
        targetPath: file.targetPath || installation.targetPath,
        relativePath: file.relativePath
      }))

    const check = await this.inspectInstallation(installation)
    if (installation.source !== 'detected' && check.state === 'intact') {
      const restoreResult = await this.restore(patchId)
      if (restoreResult.restored) {
        const prunedDirectories = await this.pruneEmptyDirectories(locations)
        return { mode: 'restored', removed: 0, restored: restoreResult.filesRestored, keptModified: [], prunedDirectories }
      }
      // restore 拒绝（存在冲突文件）→ 落入尽力而为清理，保用户改动文件
    }

    let removed = 0
    let restored = 0
    let quarantined = 0
    const keptModified = []
    for (const file of [...(installation.files || [])].reverse()) {
      const targetPath = file.targetPath || installation.targetPath
      const destination = ensureWithin(targetPath, path.join(targetPath, file.relativePath))
      const currentStats = await fsp.stat(destination).catch(() => null)
      if (!currentStats?.isFile()) continue
      if (await sha256(destination) !== file.installedHash) {
        // 引入文件被改动/损坏：挪进隔离区（内容不丢），安装位置让给新版本——
        // 否则改名升级时旧目录清不干净，旧版本会按覆盖排序压住新版本。
        // 隔离区独立于备份目录（备份目录在本方法末尾会整体删除）。
        // 识别安装没有备份区：用户手工装的内容，原地保留。
        if (!file.hadOriginal && installation.backupDirectory) {
          const quarantineRoot = path.join(this.userDataDirectory, 'quarantine', patchId, String(Date.now()))
          const quarantinePath = ensureWithin(quarantineRoot,
            path.join(quarantineRoot, file.relativePath))
          await fsp.mkdir(path.dirname(quarantinePath), { recursive: true })
          try {
            await fsp.rename(destination, quarantinePath)
          } catch {
            await fsp.copyFile(destination, quarantinePath).catch(() => {})
            await fsp.rm(destination, { force: true })
          }
          quarantined += 1
          continue
        }
        keptModified.push(file.relativePath)
        continue
      }
      if (file.hadOriginal && file.backupPath) {
        const backupStats = await fsp.stat(file.backupPath).catch(() => null)
        if (backupStats?.isFile()) {
          await fsp.copyFile(file.backupPath, destination)
          restored += 1
          continue
        }
      }
      await fsp.rm(destination, { force: true })
      removed += 1
    }

    const prunedDirectories = await this.pruneEmptyDirectories(locations)
    delete state.installations[patchId]
    await this.writeState(state)
    await fsp.rm(installation.backupDirectory, { recursive: true, force: true }).catch(() => {})
    return { mode: 'best-effort', removed, restored, quarantined, keptModified, prunedDirectories }
  }

  /**
   * 清理文件删除后留下的空目录：收集所有受影响目录（最深优先），逐个「目录为空
   * 才 rmdir」，直至安装目标根为止（根目录本身不删）。Windows 上刚删除的文件可能
   * 短暂仍出现在 readdir 结果里（实时杀毒/索引服务持有句柄导致删除延迟生效），
   * 因此间隔重试几轮，保证空目录一定被清掉。
   */
  async pruneEmptyDirectories(locations) {
    let pruned = 0
    const candidates = new Map()
    for (const { targetPath, relativePath } of locations) {
      if (!targetPath || !relativePath) continue
      const root = path.resolve(targetPath)
      let current = path.dirname(ensureWithin(root, path.join(root, relativePath)))
      while (path.resolve(current) !== root) {
        const key = path.resolve(current).toLowerCase()
        if (!candidates.has(key)) candidates.set(key, path.resolve(current))
        current = path.dirname(current)
      }
    }
    // 最深的目录排前面：子目录删空后父目录才能跟着删
    const ordered = [...candidates.values()].sort(
      (a, b) => b.split(path.sep).length - a.split(path.sep).length
    )
    const removeIfEmpty = async (dirPath) => {
      try {
        const entries = await fsp.readdir(dirPath)
        if (entries.length > 0) return false
        await fsp.rmdir(dirPath)
        return true
      } catch {
        return false
      }
    }
    for (let attempt = 0; attempt < 4 && ordered.length > 0; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 120))
      for (const dirPath of ordered) {
        if (await removeIfEmpty(dirPath)) pruned += 1
      }
    }
    return pruned
  }

  async inspectInstallation(installation) {
    const missingFiles = []
    const modifiedFiles = []
    const files = Array.isArray(installation?.files) ? installation.files : []

    // 并发校验：语音包 2600+ 文件串行哈希要 2 秒以上，8 路并发约 0.4 秒
    const queue = files.map((file, index) => ({ file, index }))
    const checkWorker = async () => {
      for (;;) {
        const next = queue.shift()
        if (!next) return
        const { file } = next
        try {
          const targetPath = file.targetPath || installation.targetPath
          const destination = ensureWithin(targetPath, path.join(targetPath, file.relativePath))
          const stats = await fsp.stat(destination).catch(() => null)
          if (!stats?.isFile()) missingFiles.push(file.relativePath)
          else if (await sha256(destination) !== file.installedHash) modifiedFiles.push(file.relativePath)
        } catch {
          missingFiles.push(file.relativePath)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, files.length || 1) }, () => checkWorker()))

    const changed = missingFiles.length > 0 || modifiedFiles.length > 0
    return {
      state: !changed ? 'intact' : installation?.source === 'detected' ? 'reinstallable' : missingFiles.length > 0 ? 'missing' : 'modified',
      checkedAt: new Date().toISOString(),
      checkedFiles: files.length,
      missingFiles,
      modifiedFiles
    }
  }

  async resolvePlanTargets(patch, primaryTarget) {
    const plan = normalizeInstallPlan(patch)
    const injective = isInjectivePatch(patch)
    const targets = new Map()
    for (const entry of plan) {
      let targetPath = primaryTarget
      if (injective) {
        // 注入式补丁：安装目标即机模包目录（要求机模已安装，以其 manifest.json 为准）
        const manifestStats = await fsp.stat(path.join(primaryTarget, 'manifest.json')).catch(() => null)
        if (!manifestStats?.isFile()) {
          throw new Error('所选目录不是机模包（缺少 manifest.json）：请选择机模包目录（如 fycyc-aircraft-c919x）')
        }
      } else if (entry.target !== 'primary') {
        if (typeof this.resolveAdditionalTarget !== 'function') {
          throw new Error('无法自动定位 GSX 图片资源目录')
        }
        targetPath = await this.resolveAdditionalTarget(entry.target, { patch, primaryTarget })
      }
      if (typeof targetPath !== 'string' || !targetPath.trim()) {
        throw new Error(`无法定位补丁安装目标：${entry.target}`)
      }
      const resolved = path.resolve(targetPath)
      const stats = await fsp.stat(resolved).catch(() => null)
      if (!stats?.isDirectory()) {
        throw new Error(`补丁安装目标不存在或不可访问：${entry.target}`)
      }
      if (entry.target === 'gsx-runtime-res') {
        const selectButton = ensureWithin(resolved, path.join(resolved, 'btn_select.png'))
        const selectStats = await fsp.stat(selectButton).catch(() => null)
        if (path.basename(resolved).toLowerCase() !== 'res' || !selectStats?.isFile()) {
          throw new Error('检测到的 GSX 图片资源目录无效')
        }
      }
      targets.set(entry.target, { ...entry, targetPath: resolved })
    }
    return targets
  }

  async reconcileInstallations(patches, targetPaths) {
    const state = await this.readState()
    const result = {}
    let changed = false

    for (const patch of Array.isArray(patches) ? patches : []) {
      const patchId = ensureSafeId(patch?.id)
      if (state.installations[patchId]) continue
      const fingerprints = fingerprintFiles(patch)
      if (fingerprints.length === 0) continue

      const requested = normalizeReconcileTargetPaths(targetPaths?.[patchId])
      if (requested.length === 0) continue

      // 逐槽位核对指纹：双版本补丁在哪个模拟器目录完整命中，就把哪个槽位记为已识别
      const matchedSlots = []
      for (const entry of requested) {
        const target = path.resolve(entry.targetPath)
        const targetStats = await fsp.stat(target).catch(() => null)
        if (!targetStats?.isDirectory()) continue
        const installTargets = await this.resolvePlanTargets(patch, target).catch(() => null)
        if (!installTargets) continue
        // 注入式补丁：指纹是 ZIP 内全路径（files/html_ui/...），而文件落在机模包内
        // （html_ui/...），匹配前剥掉 contentRoot 前缀；不以该前缀开头的条目
        // （如发布 ZIP 根的注入/还原脚本、说明文件）不属于机模包内容，跳过
        const injective = isInjectivePatch(patch)
        const contentRootPrefix = injective
          ? `${normalizeContentRoot(patch?.package?.installPlan?.[0]?.contentRoot ?? patch?.package?.contentRoot ?? '')}/`
          : ''
        const fingerprintsToMatch = injective
          ? fingerprints.filter((file) => contentRootPrefix === '/' || file.relativePath.startsWith(contentRootPrefix))
          : fingerprints
        if (fingerprintsToMatch.length === 0) continue
        const matchedFiles = []
        for (const file of fingerprintsToMatch) {
          try {
            const fileTarget = installTargets.get(file.target || 'primary')
            if (!fileTarget) break
            let relativePath = file.relativePath
            if (injective && contentRootPrefix !== '/' && relativePath.startsWith(contentRootPrefix)) {
              relativePath = relativePath.slice(contentRootPrefix.length)
            }
            const destination = ensureWithin(fileTarget.targetPath, path.join(fileTarget.targetPath, relativePath))
            const stats = await fsp.stat(destination).catch(() => null)
            if (!stats?.isFile() || await sha256(destination) !== file.sha256) break
            matchedFiles.push({
              target: file.target || 'primary',
              slot: entry.slot,
              targetPath: fileTarget.targetPath,
              relativePath,
              hadOriginal: false,
              backupPath: null,
              installedHash: file.sha256
            })
          } catch {
            break
          }
        }
        if (matchedFiles.length === fingerprintsToMatch.length) {
          matchedSlots.push({ targetPath: target, slot: entry.slot, files: matchedFiles })
        }
      }

      if (matchedSlots.length === 0) continue
      const now = new Date().toISOString()
      state.installations[patchId] = {
        patchId,
        name: patch.name,
        version: patch.version,
        targetPath: matchedSlots[0].targetPath,
        slots: matchedSlots
          .map(({ targetPath, slot }) => ({ slot, targetPath }))
          .filter((slotEntry) => slotEntry.slot),
        installedAt: now,
        detectedAt: now,
        source: 'detected',
        backupDirectory: null,
        files: matchedSlots.flatMap(({ files }) => files)
      }
      result[patchId] = 'recognized'
      changed = true
    }

    if (changed) await this.writeState(state)
    return result
  }

  async verifyInstallations() {
    const installations = await this.listInstallations()
    const result = {}

    for (const [patchId, installation] of Object.entries(installations)) {
      result[patchId] = await this.inspectInstallation(installation)
    }

    return result
  }

  emit(patchId, payload) {
    this.onProgress({ patchId, ...payload })
  }

  async installFromFile(patch, targetPath, sourceArchivePath) {
    if (typeof sourceArchivePath !== 'string' || !sourceArchivePath.trim()) {
      throw new Error('请选择离线补丁包')
    }
    const source = path.resolve(sourceArchivePath)
    const sourceStats = await fsp.stat(source).catch(() => null)
    if (!sourceStats?.isFile()) {
      throw new Error('离线补丁包不存在或无法访问')
    }
    return this.install(patch, targetPath, { localArchivePath: source })
  }

  async install(patch, targetPaths, { localArchivePath = null } = {}) {
    const patchId = ensureSafeId(patch?.id)
    if (patch.status !== 'published' || !patch.package) {
      throw new Error('该补丁尚未发布')
    }
    // 双版本补丁传入多个槽位目标（缺失的模拟器由调用方过滤后不出现），单目标补丁仍是单个目录
    const slotTargets = normalizeInstallTargets(targetPaths)
    if (slotTargets.length === 0) {
      throw new Error('请选择安装目录')
    }

    const plan = normalizeInstallPlan(patch)
    if (slotTargets.length > 1 && plan.some((entry) => entry.target !== 'primary')) {
      throw new Error('多版本安装仅支持单一内容目标的补丁')
    }

    for (const slotTarget of slotTargets) {
      const targetStats = await fsp.stat(slotTarget.targetPath).catch(() => null)
      if (!targetStats?.isDirectory()) {
        throw new Error(`安装目录不存在或不可访问${slotTarget.slot ? `（${slotTarget.slot}）` : ''}`)
      }
      await validateInstallationTarget(patch, slotTarget.targetPath)
    }

    // 单槽位沿用既有计划解析（GSX 总补丁的 gsx-runtime-res 在此定位）；多槽位只有 primary 内容目标
    let resolvedPlanTargets = null
    if (slotTargets.length === 1) {
      resolvedPlanTargets = await this.resolvePlanTargets(patch, slotTargets[0].targetPath)
    }

    // 重装 = 先卸载旧版再装新版（2.3.1）：无论旧记录是托管还是识别安装、是否完好，
    // 都先尽力卸载干净（哈希一致才删、保留用户改动文件、清理空目录），再安装新包。
    // 防止包目录改名（zzz-* → zzz-JCH-*）后旧目录残留，在社区目录覆盖排序中压住新版本。
    const reinstallReport = await this.uninstallForReinstall(patchId)
    if (reinstallReport.quarantined > 0 || reinstallReport.keptModified.length > 0) {
      this.emit(patchId, {
        phase: 'prepare',
        percent: 0,
        message: `旧版本已清理：${reinstallReport.quarantined} 个被改动/损坏的旧文件移入备份区` +
            (reinstallReport.keptModified.length > 0 ? `，${reinstallReport.keptModified.length} 个手工安装文件原样保留` : '')
      })
    }

    const workingDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'gsx-chinese-'))
    const archivePath = path.join(workingDirectory, 'patch.zip')
    const extractDirectory = path.join(workingDirectory, 'content')
    const backupDirectory = path.join(this.backupRoot, patchId, String(Date.now()))
    const appliedFiles = []
    const preparedBackups = new Set()
    const slotPlanTargets = new Map()
    for (const slotTarget of slotTargets) {
      slotPlanTargets.set(slotTarget, resolvedPlanTargets
        ?? new Map(plan.map((entry) => [entry.target, { ...entry, targetPath: slotTarget.targetPath }])))
    }

    try {
      const fingerprints = fingerprintFiles(patch)
      if (patch.targetKind === 'gsx-audio' && fingerprints.length === 0) {
        throw new Error('GSX 中文语音包缺少文件清单，无法在下载前安全备份原始语音')
      }
      if (fingerprints.length > 0) {
        await fsp.mkdir(backupDirectory, { recursive: true })
        if (patch.targetKind === 'gsx-audio') {
          this.emit(patchId, { phase: 'backup', percent: 0, message: `正在备份原始语音 0/${fingerprints.length}` })
        }
        for (const slotTarget of slotTargets) {
          const installTargets = slotPlanTargets.get(slotTarget)
          for (let index = 0; index < fingerprints.length; index += 1) {
            const file = fingerprints[index]
            const installTarget = installTargets.get(file.target)
            if (!installTarget) throw new Error(`补丁文件目标无效：${file.target}`)
            const destination = ensureWithin(installTarget.targetPath, path.join(installTarget.targetPath, file.relativePath))
            const existingStats = await fsp.stat(destination).catch(() => null)
            if (existingStats?.isFile()) {
              const backupPath = ensureWithin(backupDirectory, path.join(backupDirectory, backupRelativePath(file.target, file.relativePath, slotTarget.slot)))
              await fsp.mkdir(path.dirname(backupPath), { recursive: true })
              await fsp.copyFile(destination, backupPath)
              preparedBackups.add(`${slotTarget.slot ?? ''}:${file.target}:${file.relativePath}`)
            }
            if (patch.targetKind === 'gsx-audio' && (index === fingerprints.length - 1 || index % 40 === 0)) {
              const percent = Math.round(((index + 1) / fingerprints.length) * 12)
              this.emit(patchId, { phase: 'backup', percent, message: `正在备份原始语音 ${index + 1}/${fingerprints.length}` })
            }
          }
        }
      }
      if (localArchivePath) {
        this.emit(patchId, { phase: 'import', percent: 0, message: '正在导入离线补丁包' })
        await fsp.copyFile(localArchivePath, archivePath)
        this.emit(patchId, { phase: 'import', percent: 55, message: '离线补丁包已导入' })
      } else {
        this.emit(patchId, { phase: 'download', percent: patch.targetKind === 'gsx-audio' ? 12 : 0, message: '正在从云端服务器下载补丁' })
        const emitDownloadProgress = ({ received, total }) => {
          const percent = total > 0
            ? Math.min(55, (patch.targetKind === 'gsx-audio' ? 12 : 0) + Math.round((received / total) * (patch.targetKind === 'gsx-audio' ? 43 : 55)))
            : patch.targetKind === 'gsx-audio' ? 12 : 0
          this.emit(patchId, {
            phase: 'download',
            percent,
            received,
            total,
            source: 'server',
            message: '正在从云端服务器下载补丁'
          })
        }
        const remoteUrl = patch.package.downloadUrl || serverPatchDownloadUrl(patchId)
        await this.download(remoteUrl, archivePath, emitDownloadProgress)
      }

      this.emit(patchId, { phase: 'verify', percent: 58, message: '正在校验补丁' })
      const actualHash = await sha256(archivePath)
      if (actualHash !== patch.package.sha256) {
        throw new Error('补丁 SHA-256 校验失败，文件可能不完整')
      }

      await fsp.mkdir(extractDirectory, { recursive: true })
      this.emit(patchId, { phase: 'extract', percent: 64, message: '正在解压补丁' })
      await extractZip(archivePath, { dir: extractDirectory })
      const planFiles = []
      for (const planEntry of plan) {
        const contentRoot = ensureWithin(extractDirectory, path.join(extractDirectory, planEntry.contentRoot))
        const contentStats = await fsp.stat(contentRoot).catch(() => null)
        if (!contentStats?.isDirectory()) {
          throw new Error(`补丁包缺少安装内容：${planEntry.target}`)
        }
        const sourceFiles = await walkFiles(contentRoot)
        if (sourceFiles.length === 0) {
          throw new Error(`补丁包安装内容为空：${planEntry.target}`)
        }
        validatePatchFiles(patchId, sourceFiles.map((sourceFile) => path.relative(contentRoot, sourceFile)))
        if (planEntry.target === 'primary') validatePatchLayoutEntries(sourceFiles, contentRoot)
        planFiles.push({ ...planEntry, contentRoot, sourceFiles })
      }

      await fsp.mkdir(backupDirectory, { recursive: true })
      const recordFiles = []
      const totalSourceFiles = planFiles.reduce((total, entry) => total + entry.sourceFiles.length, 0) * slotTargets.length
      let installedCount = 0
      let skippedManifestCount = 0
      for (const slotTarget of slotTargets) {
        const installTargets = slotPlanTargets.get(slotTarget)
        for (const planEntry of planFiles) {
          const installTarget = installTargets.get(planEntry.target)
          for (const sourceFile of planEntry.sourceFiles) {
            const relativePath = path.relative(planEntry.contentRoot, sourceFile)
            if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
              throw new Error(`补丁文件路径无效：${relativePath}`)
            }
            const destination = ensureWithin(installTarget.targetPath, path.join(installTarget.targetPath, relativePath))
            const backupPath = ensureWithin(backupDirectory, path.join(backupDirectory, backupRelativePath(planEntry.target, relativePath, slotTarget.slot)))
            const existingStats = await fsp.stat(destination).catch(() => null)
            if (existingStats?.isDirectory()) {
              throw new Error(`目标位置是目录，无法写入文件：${relativePath}`)
            }

            // 版本标记守卫：磁盘 manifest 比补丁捆绑的更新时跳过覆盖（不备份、不写
            // 安装记录，还原时因此不会触碰它）。进度照常推进。
            if (relativePath.toLowerCase() === 'manifest.json' && planEntry.target === 'primary'
              && await shouldSkipOlderManifestOverlay(sourceFile, destination)) {
              skippedManifestCount += 1
              installedCount += 1
              const percent = 68 + Math.round((installedCount / totalSourceFiles) * 30)
              this.emit(patchId, { phase: 'install', percent, message: `已保留更新的版本标记，跳过 ${relativePath}` })
              continue
            }

            const hadOriginal = Boolean(existingStats?.isFile())
            if (hadOriginal && !preparedBackups.has(`${slotTarget.slot ?? ''}:${planEntry.target}:${relativePath}`)) {
              await fsp.mkdir(path.dirname(backupPath), { recursive: true })
              await fsp.copyFile(destination, backupPath)
            }

            try {
              await fsp.mkdir(path.dirname(destination), { recursive: true })
              await fsp.copyFile(sourceFile, destination)
            } catch (error) {
              throw translateWriteError(error, destination)
            }
            const installedHash = await sha256(destination)
            const installedSize = (await fsp.stat(destination)).size
            const fileRecord = {
              target: planEntry.target,
              slot: slotTarget.slot,
              targetPath: installTarget.targetPath,
              relativePath,
              hadOriginal,
              backupPath: hadOriginal ? backupPath : null,
              installedHash,
              installedSize
            }
            recordFiles.push(fileRecord)
            appliedFiles.push({ destination, ...fileRecord })

            installedCount += 1
            const percent = 68 + Math.round((installedCount / totalSourceFiles) * 30)
            this.emit(patchId, { phase: 'install', percent, message: `正在安装 ${installedCount}/${totalSourceFiles}` })
          }
        }
      }

      for (const slotTarget of slotTargets) {
        const primaryFiles = recordFiles.filter((file) => file.target === 'primary' && file.targetPath === slotTarget.targetPath)
        // 注入式补丁跳过：机模包 layout 的同步由下方注入段全权负责（先备份原版再改），
        // 否则这里会先改写 date，备份就不再是字节级原版
        if (isInjectivePatch(patch)) continue
        if (await synchronizeInstalledLayoutDates(slotTarget.targetPath, primaryFiles)) {
          const layoutRecord = primaryFiles.find((file) => file.relativePath.toLowerCase() === 'layout.json')
          if (layoutRecord) layoutRecord.installedHash = await sha256(path.join(slotTarget.targetPath, layoutRecord.relativePath))
        }
      }

      // 注入式补丁：机模包自己的 layout.json 不随补丁分发，需就地同步——
      // 备份厂商原版 → 已登记条目更新 size/date、新增条目插入 content 数组 →
      // layout.json 以覆盖文件身份写入安装记录（还原时同样回滚到备份）。
      if (isInjectivePatch(patch)) {
        for (const slotTarget of slotTargets) {
          const vendorRoot = slotPlanTargets.get(slotTarget).get('primary').targetPath
          const slot = slotTarget.slot ?? null
          const slotFiles = recordFiles.filter((file) => (file.slot ?? null) === slot
            && file.targetPath === vendorRoot && file.relativePath.toLowerCase() !== 'layout.json')
          if (slotFiles.length === 0) continue
          const layoutPath = path.join(vendorRoot, 'layout.json')
          const layoutStats = await fsp.stat(layoutPath).catch(() => null)
          if (!layoutStats?.isFile()) continue
          const backupPath = ensureWithin(backupDirectory, path.join(backupDirectory, 'layout.json'))
          await fsp.mkdir(path.dirname(backupPath), { recursive: true })
          await fsp.copyFile(layoutPath, backupPath)
          const layoutText = await fsp.readFile(layoutPath, 'utf8')
          const updated = synchronizeVendorLayoutEntries(layoutText, slotFiles.map((file) => ({
            relativePath: file.relativePath,
            size: file.installedSize
          })))
          if (updated === layoutText) continue
          await fsp.writeFile(layoutPath, updated, 'utf8')
          const layoutRecord = {
            target: 'primary',
            slot: slotTarget.slot,
            targetPath: vendorRoot,
            relativePath: 'layout.json',
            hadOriginal: true,
            backupPath,
            installedHash: await sha256(layoutPath),
            installedSize: (await fsp.stat(layoutPath)).size
          }
          recordFiles.push(layoutRecord)
          appliedFiles.push({ destination: layoutPath, ...layoutRecord })
        }
      }

      const installation = {
        patchId,
        name: patch.name,
        version: patch.version,
        targetPath: slotTargets[0].targetPath,
        slots: slotTargets
          .filter((slotTarget) => slotTarget.slot)
          .map((slotTarget) => ({ slot: slotTarget.slot, targetPath: slotTarget.targetPath })),
        installedAt: new Date().toISOString(),
        source: 'managed',
        backupDirectory,
        files: recordFiles
      }
      const latestState = await this.readState()
      latestState.installations[patchId] = installation
      await this.writeState(latestState)
      this.emit(patchId, {
        phase: 'complete',
        percent: 100,
        message: skippedManifestCount > 0
          ? `安装完成（已保留 ${skippedManifestCount} 个更新的版本标记文件）`
          : '安装完成'
      })
      return installation
    } catch (error) {
      for (const file of appliedFiles.reverse()) {
        try {
          if (file.hadOriginal && file.backupPath) {
            await fsp.copyFile(file.backupPath, file.destination)
          } else {
            await fsp.rm(file.destination, { force: true })
          }
        } catch {
          // Preserve the original error; remaining backups stay on disk for manual recovery.
        }
      }
      this.emit(patchId, { phase: 'error', percent: 0, message: error.message })
      throw error
    } finally {
      await fsp.rm(workingDirectory, { recursive: true, force: true }).catch(() => {})
    }
  }

  async restore(patchIdInput) {
    const patchId = ensureSafeId(patchIdInput)
    const state = await this.readState()
    const installation = state.installations[patchId]
    if (!installation) {
      return { restored: true, conflicts: [], filesRestored: 0 }
    }

    if (installation.source === 'detected') {
      return {
        restored: false,
        conflicts: installation.files.map((file) => file.relativePath),
        filesRestored: 0,
        reason: 'detected-installation-without-original-backup'
      }
    }

    const conflicts = []
    let filesRestored = 0
    for (const file of [...installation.files].reverse()) {
      const targetPath = file.targetPath || installation.targetPath
      const destination = ensureWithin(targetPath, path.join(targetPath, file.relativePath))
      if (file.hadOriginal) {
        const backupStats = await fsp.stat(file.backupPath).catch(() => null)
        const currentStats = await fsp.stat(destination).catch(() => null)
        if (!backupStats?.isFile() || !currentStats?.isFile() || await sha256(destination) !== file.installedHash) {
          conflicts.push(file.relativePath)
          continue
        }
        await fsp.mkdir(path.dirname(destination), { recursive: true })
        await fsp.copyFile(file.backupPath, destination)
        filesRestored += 1
        continue
      }

      const currentStats = await fsp.stat(destination).catch(() => null)
      if (!currentStats) continue
      if (!currentStats.isFile() || await sha256(destination) !== file.installedHash) {
        conflicts.push(file.relativePath)
        continue
      }
      await fsp.rm(destination, { force: true })
      filesRestored += 1
    }

    if (conflicts.length === 0) {
      delete state.installations[patchId]
      await this.writeState(state)
      await fsp.rm(installation.backupDirectory, { recursive: true, force: true }).catch(() => {})
    }

    return { restored: conflicts.length === 0, conflicts, filesRestored }
  }
}

module.exports = {
  translateWriteError,
  PatchInstaller,
  currentWindowsFileTime,
  downloadToFile,
  ensureWithin,
  normalizeInstallTargets,
  serverPatchDownloadUrl,
  synchronizeInstalledLayoutDates,
  isAllowedDownloadUrl,
  normalizeContentRoot,
  validateInstallationTarget,
  validatePatchFiles,
  validatePatchLayoutEntries,
  sha256,
  UNSUPPORTED_PATCH_IDS
}
