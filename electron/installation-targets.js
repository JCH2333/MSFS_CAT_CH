const fs = require('node:fs/promises')
const path = require('node:path')

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
  return [...new Set([path.join(normalized, 'Community'), normalized])]
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

async function detectPatchTargets(patches, options = {}) {
  const configured = await configuredRoots(options)
  const knownRoots = Array.isArray(options.packageRoots) ? options.packageRoots : []
  const roots = [...configured, ...knownRoots]
  const result = {}

  for (const patch of patches || []) {
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
  detectPatchTargets,
  normalizeTargetFolders,
  parseInstalledPackagesPath
}
