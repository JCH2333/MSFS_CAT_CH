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

function classifySimSlot(source) {
  return SIM_SLOT_RULES.find(({ pattern }) => pattern.test(source || ''))?.slot || null
}

function dualSimMarkerFolder(patch) {
  const marker = patch?.dualSim?.markerFolder
  return typeof marker === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(marker.trim())
    ? marker.trim()
    : null
}

function entryNameMatchesMarker(entryName, markerFolder) {
  const name = entryName.toLowerCase()
  const marker = markerFolder.toLowerCase()
  // 精确命中本体包（inibuilds-aircraft-a350）；前缀命中覆盖涂装包命名（inibuilds-aircraft-a350-900-…）
  return name === marker || name.startsWith(`${marker}-`)
}

async function findMarkerCommunityRoot(root, markerFolder) {
  let fallback = null
  for (const communityRoot of communityRoots(root.packageRoot)) {
    if (!await isDirectory(communityRoot)) continue
    let entries
    try {
      entries = await fs.readdir(communityRoot, { withFileTypes: true })
    } catch {
      continue
    }
    let exact = false
    let prefixed = false
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entryNameMatchesMarker(entry.name, markerFolder)) continue
      if (entry.name.toLowerCase() === markerFolder.toLowerCase()) {
        exact = true
        break
      }
      prefixed = true
    }
    if (exact) return { targetPath: communityRoot, source: root.source }
    if (prefixed && !fallback) fallback = { targetPath: communityRoot, source: root.source }
  }
  return fallback
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
        timeout: 4000,
        maxBuffer: 2 * 1024 * 1024
      })
      return parseAddonManagerRoots(stdout)
    } catch {
      return []
    }
  }))
  return normalizeAudioRoots(results.flat())
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

    // 双版本补丁（如 iniBuilds A350 汉化）：按模拟器槽位分别定位含标记包的社区目录
    const markerFolder = dualSimMarkerFolder(patch)
    if (patch?.id && markerFolder) {
      const slots = []
      const seenSlots = new Set()
      for (const root of roots) {
        const slot = classifySimSlot(root?.source)
        if (!slot || seenSlots.has(slot)) continue
        const found = await findMarkerCommunityRoot(root, markerFolder)
        if (!found) continue
        seenSlots.add(slot)
        slots.push({ slot, ...found })
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
  detectGsxRuntimeResTarget,
  detectPatchTargets,
  normalizeTargetFolders,
  parseInstalledPackagesPath,
  parseAddonManagerRoots,
  registeredAddonManagerRoots
}
