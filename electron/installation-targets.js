const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const DEFAULT_CONFIG_LOCATIONS = [
  { source: 'Steam / MSFS 2024', relativePath: path.join('Microsoft Flight Simulator 2024', 'UserCfg.opt') },
  { source: 'Steam / MSFS 2020', relativePath: path.join('Microsoft Flight Simulator', 'UserCfg.opt') }
]

const STORE_CONFIG_LOCATIONS = [
  { source: 'Microsoft Store / MSFS 2024', relativePath: path.join('Microsoft.Limitless_8wekyb3d8bbwe', 'LocalCache', 'UserCfg.opt') },
  { source: 'Microsoft Store / MSFS 2020', relativePath: path.join('Microsoft.FlightSimulator_8wekyb3d8bbwe', 'LocalCache', 'UserCfg.opt') }
]

function normalizeTargetFolders(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((folder) => (
    typeof folder === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(folder.trim())
  )).map((folder) => folder.trim()))]
}

function parseInstalledPackagesPath(contents) {
  const match = /InstalledPackagesPath\s+"([^"]+)"/i.exec(contents)
  return match ? match[1].trim() : null
}

async function isDirectory(candidate) {
  try {
    return (await fs.stat(candidate)).isDirectory()
  } catch {
    return false
  }
}

function communityRoots(packageRoot) {
  const normalized = path.resolve(packageRoot)
  // MSFS 2024（SU4 起）社区目录更名为 Community2024，旧版仍为 Community；
  // 两个都作为候选，最后回退到包根本身（个别用户把包路径直接指到社区层）。
  return [...new Set([
    path.join(normalized, 'Community2024'),
    path.join(normalized, 'Community'),
    normalized
  ])]
}

const SIM_SLOT_RULES = [
  { slot: 'msfs2024', pattern: /msfs\s*2024/i },
  { slot: 'msfs2020', pattern: /msfs\s*2020/i }
]

const SLOT_ORDER = { msfs2024: 0, msfs2020: 1 }

// GSX 文本补丁（gsx-combined）的安装目标包名，与 gsx-updater 的 GSX_PACKAGE_FOLDER 一致
const GSX_COMBINED_PACKAGE_FOLDER = 'fsdreamteam-gsx-pro'

function classifySimSlot(source) {
  return SIM_SLOT_RULES.find(({ pattern }) => pattern.test(source || ''))?.slot || null
}

function dualSimEnabled(patch) {
  return Boolean(patch?.dualSim)
}

// 各槽位的惯例社区目录名（配置目录缺失时按此顺序回退，最后回退到包根本身）
const SLOT_COMMUNITY_FALLBACKS = {
  msfs2024: ['Community2024', 'Community'],
  msfs2020: ['Community']
}

// 服务端 dualSim.slots 配置：[{slot, communityFolder?}]；空/缺省 = 默认双槽位
function configuredMultiSimSlots(patch) {
  const raw = Array.isArray(patch?.dualSim?.slots) ? patch.dualSim.slots : []
  const seen = new Set()
  const slots = []
  for (const entry of raw) {
    const slot = typeof entry?.slot === 'string' ? entry.slot.trim().toLowerCase() : ''
    if (!Object.prototype.hasOwnProperty.call(SLOT_COMMUNITY_FALLBACKS, slot) || seen.has(slot)) continue
    seen.add(slot)
    const folder = typeof entry?.communityFolder === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.communityFolder.trim())
      ? entry.communityFolder.trim()
      : null
    slots.push({ slot, communityFolder: folder })
  }
  if (!slots.length) {
    slots.push({ slot: 'msfs2024', communityFolder: null }, { slot: 'msfs2020', communityFolder: null })
  }
  return slots
}

async function findConfiguredCommunityRoot(root, slot, communityFolder) {
  const candidates = []
  if (communityFolder) candidates.push(path.join(root.packageRoot, communityFolder))
  for (const name of SLOT_COMMUNITY_FALLBACKS[slot] || []) {
    candidates.push(path.join(root.packageRoot, name))
  }
  candidates.push(path.resolve(root.packageRoot))
  for (const candidate of candidates) {
    if (await isDirectory(candidate)) return { targetPath: candidate, source: root.source }
  }
  return null
}

async function configuredRoots({ appData, localAppData, configLocations }) {
  const locations = configLocations || [
    ...(appData ? DEFAULT_CONFIG_LOCATIONS.map((entry) => ({ ...entry, filePath: path.join(appData, entry.relativePath) })) : []),
    ...(localAppData ? STORE_CONFIG_LOCATIONS.map((entry) => ({ ...entry, filePath: path.join(localAppData, 'Packages', entry.relativePath) })) : [])
  ]
  const roots = []

  for (const location of locations) {
    try {
      const packageRoot = parseInstalledPackagesPath(await fs.readFile(location.filePath, 'utf8'))
      if (packageRoot) roots.push({ packageRoot, source: location.source })
    } catch {
      // Missing simulator configurations are normal on machines with one distribution channel.
    }
  }
  return roots
}

function normalizeAudioRoots(value, fallbackSource = 'FSDreamTeam Addon Manager') {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const roots = []
  for (const entry of value) {
    const rootPath = typeof entry === 'string' ? entry : entry?.rootPath || entry?.targetPath
    if (typeof rootPath !== 'string' || !rootPath.trim()) continue
    const normalized = path.resolve(rootPath.trim())
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    roots.push({ rootPath: normalized, source: typeof entry === 'object' && entry?.source ? entry.source : fallbackSource })
  }
  return roots
}

function parseAddonManagerRoots(registryOutput) {
  const roots = []
  let entry = null
  for (const rawLine of String(registryOutput || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (/^HKEY_/i.test(line)) {
      if (entry) roots.push(entry)
      entry = { displayName: '', installLocation: '' }
      continue
    }
    if (!entry) continue
    const displayName = /^DisplayName\s+REG_\w+\s+(.+)$/i.exec(line)
    if (displayName) {
      entry.displayName = displayName[1].trim()
      continue
    }
    const installLocation = /^InstallLocation\s+REG_\w+\s+(.+)$/i.exec(line)
    if (installLocation) entry.installLocation = installLocation[1].trim()
  }
  if (entry) roots.push(entry)

  return roots
    .filter(({ displayName, installLocation }) => (
      installLocation
      && (/fsdreamteam|addon manager|gsx/i.test(displayName) || /(?:^|[\\/])addon manager[\\/]*$/i.test(installLocation))
    ))
    .map(({ installLocation }) => ({ rootPath: installLocation, source: 'FSDreamTeam Addon Manager' }))
}

async function registeredAddonManagerRoots() {
  if (process.platform !== 'win32') return []
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]
  const results = await Promise.all(keys.map(async (key) => {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', key, '/s'], {
        windowsHide: true,
        // 装机较多的机器上全树枚举可能超过数秒；超时会导致找不到 FSDT 根目录
        timeout: 12000,
        maxBuffer: 4 * 1024 * 1024
      })
      return parseAddonManagerRoots(stdout)
    } catch {
      return []
    }
  }))
  return normalizeAudioRoots(results.flat())
}

// 由社区包主目标反推 Addon Manager 根目录：FSDT 标准布局为 <根>\MSFS\<包名>。
function addonManagerRootsFromPrimaryPath(primaryTarget) {
  if (typeof primaryTarget !== 'string' || !primaryTarget.trim()) return []
  const match = /^(.+)[\\/]MSFS[\\/][^\\/]+$/i.exec(path.resolve(primaryTarget.trim()))
  return match ? [match[1]] : []
}

// 由已记录的 gsx-runtime-res 目标反推根目录：<根>\couatl[64]\GSX\res。
function addonManagerRootsFromRecordedResPath(resPath) {
  if (typeof resPath !== 'string' || !resPath.trim()) return []
  const match = /^(.+)[\\/]couatl(?:64)?[\\/]GSX[\\/]res$/i.exec(path.resolve(resPath.trim()))
  return match ? [match[1]] : []
}

// 读取历史安装记录中该补丁用过的 GSX 图片资源目录（反推回根目录再复检）。
async function recordedGsxRuntimeResRoots(userDataDirectory, patchId) {
  if (!userDataDirectory) return []
  try {
    const raw = JSON.parse(await fs.readFile(path.join(userDataDirectory, 'installations.json'), 'utf8'))
    const installations = Array.isArray(raw?.installations)
      ? raw.installations
      : Object.values(raw?.installations || {})
    const roots = []
    for (const record of installations) {
      if (patchId && record?.patchId && record.patchId !== patchId) continue
      for (const file of Array.isArray(record?.files) ? record.files : []) {
        if (file?.target !== 'gsx-runtime-res' || typeof file?.targetPath !== 'string') continue
        roots.push(...addonManagerRootsFromRecordedResPath(file.targetPath))
      }
    }
    return [...new Set(roots)]
  } catch {
    return []
  }
}

function gsxAudioCandidates(audioRoots) {
  const candidates = []
  for (const root of audioRoots) {
    candidates.push(
      { targetPath: root.rootPath, source: root.source },
      { targetPath: path.join(root.rootPath, 'couatl', 'GSX'), source: root.source },
      { targetPath: path.join(root.rootPath, 'couatl64', 'GSX'), source: root.source }
    )
  }
  return candidates
}

function gsxRuntimeResCandidates(runtimeRoots) {
  const candidates = []
  for (const root of runtimeRoots) {
    candidates.push(
      { targetPath: path.join(root.rootPath, 'couatl', 'GSX', 'res'), source: root.source },
      { targetPath: path.join(root.rootPath, 'couatl64', 'GSX', 'res'), source: root.source }
    )
  }
  return candidates
}

async function detectGsxRuntimeResTarget(options = {}) {
  const configuredRoots = normalizeAudioRoots(options.runtimeRoots)
  const registryRoots = configuredRoots.length ? [] : await registeredAddonManagerRoots()
  const candidates = []
  const seen = new Set()

  for (const candidate of gsxRuntimeResCandidates([...configuredRoots, ...registryRoots])) {
    const normalized = path.resolve(candidate.targetPath)
    const key = normalized.toLowerCase()
    if (seen.has(key) || !await isDirectory(normalized)) continue
    if (!await isDirectory(path.join(normalized, 'fonts'))) continue
    if (!await fs.stat(path.join(normalized, 'btn_select.png')).then((stats) => stats.isFile()).catch(() => false)) continue
    seen.add(key)
    candidates.push({ targetPath: normalized, source: candidate.source })
  }

  return candidates.length ? { ...candidates[0], candidates } : null
}

async function detectPatchTargets(patches, options = {}) {
  const configured = await configuredRoots(options)
  const knownRoots = Array.isArray(options.packageRoots) ? options.packageRoots : []
  const roots = [...configured, ...knownRoots]
  const wantsGsxAudio = (patches || []).some((patch) => patch?.targetKind === 'gsx-audio')
  const configuredAudioRoots = normalizeAudioRoots(options.audioRoots)
  const rememberedAudioRoots = normalizeAudioRoots(options.knownAudioTargets, '已记录的 GSX 语音目录')
  const registryAudioRoots = wantsGsxAudio && !configuredAudioRoots.length ? await registeredAddonManagerRoots() : []
  const audioCandidates = gsxAudioCandidates([...configuredAudioRoots, ...rememberedAudioRoots, ...registryAudioRoots])
  const result = {}

  for (const patch of patches || []) {
    if (patch?.id && patch?.targetKind === 'gsx-audio') {
      const candidates = []
      const seen = new Set()
      for (const candidate of audioCandidates) {
        const key = candidate.targetPath.toLowerCase()
        if (seen.has(key) || !await isDirectory(path.join(candidate.targetPath, 'sounds'))) continue
        seen.add(key)
        candidates.push(candidate)
      }
      if (candidates.length) result[patch.id] = { ...candidates[0], candidates }
      continue
    }

    // GSX 文本补丁（gsx-combined）：目标是社区目录里的 GSX Pro 插件包文件夹，
    // 自部署 junction 与官方安装产物均可解析。此前该类型不做自动检测——卸载清空
    // 安装记录后会陷入「请先选择目录」死路，自动重装链也因此拿不到目标。
    if (patch?.id && patch?.targetKind === 'gsx-combined') {
      for (const root of roots) {
        if (!root?.packageRoot || !root?.source) continue
        for (const communityRoot of communityRoots(root.packageRoot)) {
          const targetPath = path.join(communityRoot, GSX_COMBINED_PACKAGE_FOLDER)
          if (await isDirectory(targetPath)) {
            result[patch.id] = { targetPath, source: root.source }
            break
          }
        }
        if (result[patch.id]) break
      }
      continue
    }

    // 多模拟器补丁（iniBuilds 机模汉化）：按服务端配置的槽位与社区子文件夹定位，
    // 不再检测机模目录——补丁包直接放入社区根目录（ZIP 内自带包目录前缀）。
    // 注入式补丁（addon-inject）例外：安装目标是机模包目录本身（targetFolders[0]），
    // 机模未安装的槽位直接跳过，不产生候选。
    if (patch?.id && dualSimEnabled(patch)) {
      const injective = patch?.targetKind === 'addon-inject'
      const vendorPackage = injective ? (normalizeTargetFolders(patch?.targetFolders)[0] || '') : ''
      const slots = []
      for (const configured of configuredMultiSimSlots(patch)) {
        for (const root of roots) {
          if (classifySimSlot(root?.source) !== configured.slot) continue
          const found = await findConfiguredCommunityRoot(root, configured.slot, configured.communityFolder)
          if (!found) continue
          if (injective) {
            const vendorPath = path.join(found.targetPath, vendorPackage)
            if (!await isDirectory(vendorPath)) continue
            slots.push({ slot: configured.slot, ...found, targetPath: vendorPath })
            break
          }
          slots.push({ slot: configured.slot, ...found })
          break
        }
      }
      slots.sort((a, b) => (SLOT_ORDER[a.slot] ?? 9) - (SLOT_ORDER[b.slot] ?? 9))
      if (slots.length) {
        result[patch.id] = { targetPath: slots[0].targetPath, source: slots[0].source, slots }
      }
      continue
    }

    const folders = normalizeTargetFolders(patch?.targetFolders)
    if (!patch?.id || folders.length === 0) continue

    const candidates = []
    const seen = new Set()
    for (const root of roots) {
      if (!root?.packageRoot || !root?.source) continue
      for (const communityRoot of communityRoots(root.packageRoot)) {
        for (const folder of folders) {
          const targetPath = path.join(communityRoot, folder)
          const key = targetPath.toLowerCase()
          if (seen.has(key) || !await isDirectory(targetPath)) continue
          seen.add(key)
          candidates.push({ targetPath, source: root.source })
        }
      }
    }

    if (candidates.length) {
      result[patch.id] = { ...candidates[0], candidates }
    }
  }

  return result
}

module.exports = {
  addonManagerRootsFromPrimaryPath,
  addonManagerRootsFromRecordedResPath,
  classifySimSlot,
  configuredRoots,
  detectGsxRuntimeResTarget,
  detectPatchTargets,
  normalizeTargetFolders,
  parseInstalledPackagesPath,
  parseAddonManagerRoots,
  recordedGsxRuntimeResRoots,
  registeredAddonManagerRoots
}
