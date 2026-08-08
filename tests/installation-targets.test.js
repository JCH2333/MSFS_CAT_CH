const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { detectPatchTargets, normalizeTargetFolders, parseInstalledPackagesPath } = require('../electron/installation-targets')

async function temporaryDirectory(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('parses an MSFS InstalledPackagesPath safely', () => {
  assert.equal(parseInstalledPackagesPath('InstalledPackagesPath "F:\\games\\community"'), 'F:\\games\\community')
  assert.equal(parseInstalledPackagesPath('GraphicsPreset 2'), null)
})

test('keeps only simple add-on folder names', () => {
  assert.deepEqual(normalizeTargetFolders(['rkapps-fsrealistic', '../outside', '']), ['rkapps-fsrealistic'])
})

test('detects Steam and Microsoft Store Community add-on targets', async () => {
  const root = await temporaryDirectory('msfs-targets-')
  const steamRoot = path.join(root, 'steam-packages')
  const storeRoot = path.join(root, 'store-packages')
  await fs.mkdir(path.join(steamRoot, 'Community', 'fsdreamteam-gsx-pro'), { recursive: true })
  await fs.mkdir(path.join(storeRoot, 'Community', 'rkapps-fsrealistic'), { recursive: true })

  const targets = await detectPatchTargets([
    { id: 'gsx-pro-zh-cn', targetFolders: ['fsdreamteam-gsx-pro'] },
    { id: 'fsrealistic-plus-zh-cn', targetFolders: ['rkapps-fsrealistic'] }
  ], {
    packageRoots: [
      { packageRoot: steamRoot, source: 'Steam / MSFS 2024' },
      { packageRoot: storeRoot, source: 'Microsoft Store / MSFS 2024' }
    ]
  })

  assert.equal(targets['gsx-pro-zh-cn'].source, 'Steam / MSFS 2024')
  assert.equal(targets['gsx-pro-zh-cn'].targetPath, path.join(steamRoot, 'Community', 'fsdreamteam-gsx-pro'))
  assert.equal(targets['fsrealistic-plus-zh-cn'].source, 'Microsoft Store / MSFS 2024')
  assert.equal(targets['fsrealistic-plus-zh-cn'].targetPath, path.join(storeRoot, 'Community', 'rkapps-fsrealistic'))
  await fs.rm(root, { recursive: true, force: true })
})

test('does not mistake a package root named community for the Community folder', async () => {
  const root = await temporaryDirectory('msfs-community-root-')
  const packageRoot = path.join(root, 'community')
  await fs.mkdir(path.join(packageRoot, 'Community', 'rkapps-fsrealistic'), { recursive: true })

  const targets = await detectPatchTargets([
    { id: 'fsrealistic-plus-zh-cn', targetFolders: ['rkapps-fsrealistic'] }
  ], { packageRoots: [{ packageRoot, source: 'Steam / MSFS 2024' }] })

  assert.equal(targets['fsrealistic-plus-zh-cn'].targetPath, path.join(packageRoot, 'Community', 'rkapps-fsrealistic'))
  await fs.rm(root, { recursive: true, force: true })
})
