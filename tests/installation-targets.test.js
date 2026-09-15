const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { detectGsxRuntimeResTarget, detectPatchTargets, normalizeTargetFolders, parseInstalledPackagesPath } = require('../electron/installation-targets')

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

test('detects the GSX audio target from an Addon Manager installation root', async () => {
  const root = await temporaryDirectory('gsx-audio-targets-')
  const addonManagerRoot = path.join(root, 'Addon Manager')
  const gsxRoot = path.join(addonManagerRoot, 'couatl', 'GSX')
  await fs.mkdir(path.join(gsxRoot, 'sounds'), { recursive: true })

  const targets = await detectPatchTargets([
    { id: 'gsx-pro-zh-cn-voice', targetKind: 'gsx-audio' }
  ], {
    audioRoots: [{ rootPath: addonManagerRoot, source: 'FSDreamTeam Addon Manager' }]
  })

  assert.equal(targets['gsx-pro-zh-cn-voice'].source, 'FSDreamTeam Addon Manager')
  assert.equal(targets['gsx-pro-zh-cn-voice'].targetPath, gsxRoot)
  await fs.rm(root, { recursive: true, force: true })
})

test('does not detect an Addon Manager folder without the GSX sounds directory', async () => {
  const root = await temporaryDirectory('gsx-audio-missing-sounds-')
  const addonManagerRoot = path.join(root, 'Addon Manager')
  await fs.mkdir(path.join(addonManagerRoot, 'couatl', 'GSX'), { recursive: true })

  const targets = await detectPatchTargets([
    { id: 'gsx-pro-zh-cn-voice', targetKind: 'gsx-audio' }
  ], {
    audioRoots: [{ rootPath: addonManagerRoot, source: 'FSDreamTeam Addon Manager' }]
  })

  assert.equal(targets['gsx-pro-zh-cn-voice'], undefined)
  await fs.rm(root, { recursive: true, force: true })
})

test('detects the GSX runtime image directory from an Addon Manager installation root', async () => {
  const root = await temporaryDirectory('gsx-runtime-res-targets-')
  const addonManagerRoot = path.join(root, 'Addon Manager')
  const resRoot = path.join(addonManagerRoot, 'couatl', 'GSX', 'res')
  await fs.mkdir(path.join(resRoot, 'fonts'), { recursive: true })
  await fs.writeFile(path.join(resRoot, 'btn_select.png'), 'button')

  const target = await detectGsxRuntimeResTarget({
    runtimeRoots: [{ rootPath: addonManagerRoot, source: 'FSDreamTeam Addon Manager' }]
  })

  assert.equal(target.source, 'FSDreamTeam Addon Manager')
  assert.equal(target.targetPath, resRoot)
  await fs.rm(root, { recursive: true, force: true })
})

test('detects dual-sim A350 community targets for MSFS 2024 and 2020', async () => {
  const root = await temporaryDirectory('a350-dual-targets-')
  const root2024 = path.join(root, 'packages-2024')
  const root2020 = path.join(root, 'packages-2020')
  await fs.mkdir(path.join(root2024, 'Community2024', 'inibuilds-aircraft-a350'), { recursive: true })
  await fs.mkdir(path.join(root2020, 'Community', 'inibuilds-aircraft-a350'), { recursive: true })

  const targets = await detectPatchTargets([
    {
      id: 'ini350-efb-zh-cn',
      targetKind: 'addon',
      targetFolders: ['zzz-a350-efb-zh-patch'],
      dualSim: { markerFolder: 'inibuilds-aircraft-a350' }
    }
  ], {
    packageRoots: [
      { packageRoot: root2020, source: 'Steam / MSFS 2020' },
      { packageRoot: root2024, source: 'Steam / MSFS 2024' }
    ]
  })

  const target = targets['ini350-efb-zh-cn']
  assert.equal(target.slots.length, 2)
  assert.equal(target.slots[0].slot, 'msfs2024')
  assert.equal(target.slots[0].targetPath, path.join(root2024, 'Community2024'))
  assert.equal(target.slots[1].slot, 'msfs2020')
  assert.equal(target.slots[1].targetPath, path.join(root2020, 'Community'))
  assert.equal(target.targetPath, target.slots[0].targetPath)
  await fs.rm(root, { recursive: true, force: true })
})

test('dual-sim detection skips a missing simulator instead of failing', async () => {
  const root = await temporaryDirectory('a350-single-target-')
  const root2024 = path.join(root, 'packages-2024')
  const root2020 = path.join(root, 'packages-2020')
  await fs.mkdir(path.join(root2024, 'Community', 'inibuilds-aircraft-a350'), { recursive: true })
  await fs.mkdir(path.join(root2020, 'Community', 'some-other-addon'), { recursive: true })

  const targets = await detectPatchTargets([
    { id: 'ini350-efb-zh-cn', targetKind: 'addon', dualSim: { markerFolder: 'inibuilds-aircraft-a350' } }
  ], {
    packageRoots: [
      { packageRoot: root2024, source: 'Microsoft Store / MSFS 2024' },
      { packageRoot: root2020, source: 'Steam / MSFS 2020' }
    ]
  })

  const target = targets['ini350-efb-zh-cn']
  assert.equal(target.slots.length, 1)
  assert.equal(target.slots[0].slot, 'msfs2024')
  assert.equal(target.slots[0].targetPath, path.join(root2024, 'Community'))
  await fs.rm(root, { recursive: true, force: true })
})

test('dual-sim detection prefers the exact A350 base package over livery-style folders', async () => {
  const root = await temporaryDirectory('a350-exact-marker-')
  const packageRoot = path.join(root, 'packages')
  await fs.mkdir(path.join(packageRoot, 'Community2024', 'inibuilds-aircraft-a350-900-4K'), { recursive: true })
  await fs.mkdir(path.join(packageRoot, 'Community', 'inibuilds-aircraft-a350'), { recursive: true })

  const targets = await detectPatchTargets([
    { id: 'ini350-efb-zh-cn', targetKind: 'addon', dualSim: { markerFolder: 'inibuilds-aircraft-a350' } }
  ], {
    packageRoots: [{ packageRoot, source: 'Steam / MSFS 2024' }]
  })

  const target = targets['ini350-efb-zh-cn']
  assert.equal(target.slots[0].targetPath, path.join(packageRoot, 'Community'))
  await fs.rm(root, { recursive: true, force: true })
})

test('add-on detection also finds targets inside the MSFS 2024 Community2024 folder', async () => {
  const root = await temporaryDirectory('community2024-targets-')
  const packageRoot = path.join(root, 'packages')
  await fs.mkdir(path.join(packageRoot, 'Community2024', 'fsdreamteam-gsx-pro'), { recursive: true })

  const targets = await detectPatchTargets([
    { id: 'gsx-pro-zh-cn', targetFolders: ['fsdreamteam-gsx-pro'] }
  ], {
    packageRoots: [{ packageRoot, source: 'Steam / MSFS 2024' }]
  })

  assert.equal(targets['gsx-pro-zh-cn'].targetPath, path.join(packageRoot, 'Community2024', 'fsdreamteam-gsx-pro'))
  await fs.rm(root, { recursive: true, force: true })
})
