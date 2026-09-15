const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')
const extractZip = require('extract-zip')
const { SERVER_HOSTNAME, buildServerUrl, serverOriginProtocol } = require('./distribution-server')

const ALLOWED_DOWNLOAD_HOSTS = new Set([SERVER_HOSTNAME])
const INSTALL_PLAN_TARGETS = new Set(['primary', 'gsx-runtime-res'])
const INSTALL_SLOT_PATTERN = /^[a-z0-9][a-z0-9-]{0,20}$/
const SERVER_PATCH_DOWNLOAD_PATH = '/api/patches/download/'

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

function dualSimMarkerFolder(patch) {
  const marker = patch?.dualSim?.markerFolder
  return typeof marker === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(marker.trim())
    ? marker.trim()
    : null
}

function folderNameMatchesMarker(entryName, markerFolder) {
  const name = entryName.toLowerCase()
  const marker = markerFolder.toLowerCase()
  return name === marker || name.startsWith(`${marker}-`)
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

  // 双版本补丁（如 A350 汉化）：目标必须是包含 A350 本体包的社区文件夹，
  // 或至少已有本补丁的安装目录（覆盖重装/更新场景），避免再装错位置
  const markerFolder = dualSimMarkerFolder(patch)
  if (!markerFolder) return
  const entries = await fsp.readdir(target, { withFileTypes: true }).catch(() => null)
  if (!entries) {
    throw new Error(`安装目录不存在或不可访问：${target}`)
  }
  const patchFolders = Array.isArray(patch.targetFolders)
    ? patch.targetFolders.filter((folder) => typeof folder === 'string').map((folder) => folder.toLowerCase())
    : []
  const markerHit = entries.some((entry) => entry.isDirectory()
    && (folderNameMatchesMarker(entry.name, markerFolder) || patchFolders.includes(entry.name.toLowerCase())))
  if (!markerHit) {
    throw new Error(`所选目录中未找到 ${markerFolder}：请选择包含 iniBuilds A350 的社区文件夹（Community 或 Community2024）`)
  }
}

function normalizeInstallPlan(patch) {
  const configured = patch?.package?.installPlan
  if (!Array.isArray(configured) || configured.length === 0) {
    return [{ target: 'primary', contentRoot: normalizeContentRoot(patch?.package?.contentRoot) }]
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
  async inspectInstallation(installation) {
    const missingFiles = []
    const modifiedFiles = []
    const files = Array.isArray(installation?.files) ? installation.files : []

    for (const file of files) {
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
    const targets = new Map()
    for (const entry of plan) {
      let targetPath = primaryTarget
      if (entry.target !== 'primary') {
        if (typeof this.resolveAdditionalTarget !== 'function') {
          throw new Error('无法自动定位 GSX 图片资源目录')
        }
        targetPath = await this.resolveAdditionalTarget(entry.target)
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

        const matchedFiles = []
        for (const file of fingerprints) {
          try {
            const fileTarget = installTargets.get(file.target || 'primary')
            if (!fileTarget) break
            const destination = ensureWithin(fileTarget.targetPath, path.join(fileTarget.targetPath, file.relativePath))
            const stats = await fsp.stat(destination).catch(() => null)
            if (!stats?.isFile() || await sha256(destination) !== file.sha256) break
            matchedFiles.push({
              target: file.target || 'primary',
              slot: entry.slot,
              targetPath: fileTarget.targetPath,
              relativePath: file.relativePath,
              hadOriginal: false,
              backupPath: null,
              installedHash: file.sha256
            })
          } catch {
            break
          }
        }
        if (matchedFiles.length === fingerprints.length) {
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

    const state = await this.readState()
    const existingInstallation = state.installations[patchId]
    if (existingInstallation) {
      const currentCheck = await this.inspectInstallation(existingInstallation)
      // Restore an unchanged managed install before applying a newer package.
      // If the target changed, keep the current files as the new baseline.
      if (existingInstallation.source !== 'detected' && currentCheck.state === 'intact') {
        const restoreResult = await this.restore(patchId)
        if (!restoreResult.restored) throw new Error('旧版本文件无法安全还原')
      }
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

            const hadOriginal = Boolean(existingStats?.isFile())
            if (hadOriginal && !preparedBackups.has(`${slotTarget.slot ?? ''}:${planEntry.target}:${relativePath}`)) {
              await fsp.mkdir(path.dirname(backupPath), { recursive: true })
              await fsp.copyFile(destination, backupPath)
            }

            await fsp.mkdir(path.dirname(destination), { recursive: true })
            await fsp.copyFile(sourceFile, destination)
            const installedHash = await sha256(destination)
            const fileRecord = {
              target: planEntry.target,
              slot: slotTarget.slot,
              targetPath: installTarget.targetPath,
              relativePath,
              hadOriginal,
              backupPath: hadOriginal ? backupPath : null,
              installedHash
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
        if (await synchronizeInstalledLayoutDates(slotTarget.targetPath, primaryFiles)) {
          const layoutRecord = primaryFiles.find((file) => file.relativePath.toLowerCase() === 'layout.json')
          if (layoutRecord) layoutRecord.installedHash = await sha256(path.join(slotTarget.targetPath, layoutRecord.relativePath))
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
      this.emit(patchId, { phase: 'complete', percent: 100, message: '安装完成' })
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
