const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  addonManagerRootsFromPrimaryPath,
  addonManagerRootsFromRecordedResPath,
  detectGsxRuntimeResTarget,
  detectPatchTargets,
  normalizeTargetFolders,
  parseInstalledPackagesPath,
  recordedGsxRuntimeResRoots
} = require('../electron/installation-targets')

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

test('detects multi-sim community targets for MSFS 2024 and 2020 without any marker folders', async () => {
  const root = await temporaryDirectory('a350-dual-targets-')
  const root2024 = path.join(root, 'packages-2024')
  const root2020 = path.join(root, 'packages-2020')
  await fs.mkdir(path.join(root2024, 'Community2024'), { recursive: true })
  await fs.mkdir(path.join(root2020, 'Community'), { recursive: true })

  const targets = await detectPatchTargets([
    {
      id: 'ini350-efb-zh-cn',
      targetKind: 'addon',
      targetFolders: ['zzz-a350-efb-zh-patch'],
      dualSim: {}
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

test('multi-sim detection falls back to the package root when no community folder exists', async () => {
  const root = await temporaryDirectory('a350-single-target-')
  const root2024 = path.join(root, 'packages-2024')
  const root2020 = path.join(root, 'packages-2020')
  await fs.mkdir(path.join(root2024, 'Community'), { recursive: true })
  // 2020 包根存在但既没有 Community 也没有 Community2024：
  // 按社区层兜底约定，包根本身作为该槽位的社区目录
  await fs.mkdir(path.join(root2020), { recursive: true })

  const targets = await detectPatchTargets([
    { id: 'ini350-efb-zh-cn', targetKind: 'addon', dualSim: { markerFolder: 'inibuilds-aircraft-a350' } }
  ], {
    packageRoots: [
      { packageRoot: root2024, source: 'Microsoft Store / MSFS 2024' },
      { packageRoot: root2020, source: 'Steam / MSFS 2020' }
    ]
  })

  const target = targets['ini350-efb-zh-cn']
  assert.equal(target.slots.length, 2)
  assert.equal(target.slots[0].slot, 'msfs2024')
  assert.equal(target.slots[0].targetPath, path.join(root2024, 'Community'))
  assert.equal(target.slots[1].slot, 'msfs2020')
  assert.equal(target.slots[1].targetPath, root2020)
  await fs.rm(root, { recursive: true, force: true })
})

test('honors the server-configured slot list and community folder for the A380 patch', async () => {
  const root = await temporaryDirectory('a380-configured-slots-')
  const root2024 = path.join(root, 'packages-2024')
  const root2020 = path.join(root, 'packages-2020')
  // 2024 包根同时存在 Community2024 与 Community：配置指定 Community 时必须优先 Community
  await fs.mkdir(path.join(root2024, 'Community2024'), { recursive: true })
  await fs.mkdir(path.join(root2024, 'Community', 'some-other-addon'), { recursive: true })
  await fs.mkdir(path.join(root2020, 'Community'), { recursive: true })

  const targets = await detectPatchTargets([
    {
      id: 'inia380-efb-zh-cn',
      targetKind: 'addon',
      dualSim: { slots: [{ slot: 'msfs2024', communityFolder: 'Community' }] }
    }
  ], {
    packageRoots: [
      { packageRoot: root2020, source: 'Steam / MSFS 2020' },
      { packageRoot: root2024, source: 'Steam / MSFS 2024' }
    ]
  })

  const target = targets['inia380-efb-zh-cn']
  // ini380 没有社区版 MSFS 2020：服务端只配置了 2024 槽位，2020 即使存在也被跳过
  assert.equal(target.slots.length, 1)
  assert.equal(target.slots[0].slot, 'msfs2024')
  assert.equal(target.slots[0].targetPath, path.join(root2024, 'Community'))
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

test('derives the Addon Manager root from an MSFS community package target', () => {
  assert.deepEqual(
    addonManagerRootsFromPrimaryPath('F:/Addon Manager/MSFS/fsdreamteam-gsx-pro'),
    [path.resolve('F:/Addon Manager')]
  )
  // 非标准布局（Community 直装、非 MSFS 层）无法反推
  assert.deepEqual(addonManagerRootsFromPrimaryPath(path.join('F:', 'games', 'Community', 'fsdreamteam-gsx-pro')), [])
  assert.deepEqual(addonManagerRootsFromPrimaryPath(''), [])
  assert.deepEqual(addonManagerRootsFromPrimaryPath(null), [])
})

test('derives the Addon Manager root from a recorded runtime-res path', () => {
  assert.deepEqual(
    addonManagerRootsFromRecordedResPath('F:/Addon Manager/couatl/GSX/res'),
    [path.resolve('F:/Addon Manager')]
  )
  assert.deepEqual(
    addonManagerRootsFromRecordedResPath('F:/Addon Manager/couatl64/GSX/res'),
    [path.resolve('F:/Addon Manager')]
  )
  assert.deepEqual(addonManagerRootsFromRecordedResPath(path.join('F:', 'somewhere', 'else')), [])
})

test('reads recorded gsx-runtime-res roots from installation records', async () => {
  const userData = await temporaryDirectory('gsx-recorded-res-')
  const records = {
    schemaVersion: 1,
    installations: {
      'gsx-pro-zh-cn': {
        patchId: 'gsx-pro-zh-cn',
        targetPath: path.join('F:', 'Addon Manager', 'MSFS', 'fsdreamteam-gsx-pro'),
        files: [
          { target: 'primary', targetPath: path.join('F:', 'Addon Manager', 'MSFS', 'fsdreamteam-gsx-pro'), relativePath: 'a.html' },
          { target: 'gsx-runtime-res', targetPath: path.join('F:', 'Addon Manager', 'couatl', 'GSX', 'res'), relativePath: 'btn_select.png' }
        ]
      },
      'other-patch': {
        patchId: 'other-patch',
        files: [
          { target: 'gsx-runtime-res', targetPath: path.join('F:', 'Elsewhere', 'couatl', 'GSX', 'res'), relativePath: 'x.png' }
        ]
      }
    }
  }
  await fs.writeFile(path.join(userData, 'installations.json'), JSON.stringify(records))

  const rootsForPatch = await recordedGsxRuntimeResRoots(userData, 'gsx-pro-zh-cn')
  assert.deepEqual(rootsForPatch, [path.join('F:', 'Addon Manager')])

  const rootsForOther = await recordedGsxRuntimeResRoots(userData, 'other-patch')
  assert.deepEqual(rootsForOther, [path.join('F:', 'Elsewhere')])

  await fs.rm(userData, { recursive: true, force: true })
})

test('falls back to the primary-derived root when the registry scan finds nothing', async () => {
  const root = await temporaryDirectory('gsx-runtime-res-fallback-')
  const addonManagerRoot = path.join(root, 'Addon Manager')
  const primaryTarget = path.join(addonManagerRoot, 'MSFS', 'fsdreamteam-gsx-pro')
  const resRoot = path.join(addonManagerRoot, 'couatl', 'GSX', 'res')
  await fs.mkdir(path.join(resRoot, 'fonts'), { recursive: true })
  await fs.writeFile(path.join(resRoot, 'btn_select.png'), 'button')

  const derivedRoots = addonManagerRootsFromPrimaryPath(primaryTarget)
  const detected = await detectGsxRuntimeResTarget({
    runtimeRoots: derivedRoots.map((rootPath) => ({ rootPath, source: '插件目录反推' }))
  })

  assert.equal(detected.targetPath, resRoot)
  await fs.rm(root, { recursive: true, force: true })
})

test('injective patch finds the vendor package in Community2024 even when a legacy Community folder exists', async () => {
  const root = await temporaryDirectory('injective-community2024-')
  const packageRoot = path.join(root, 'packages')
  // SU4 用户典型布局：新旧两个社区目录并存，机模装在 Community2024
  await fs.mkdir(path.join(packageRoot, 'Community2024', 'fycyc-aircraft-c919x', 'html_ui'), { recursive: true })
  await fs.mkdir(path.join(packageRoot, 'Community', 'some-other-addon'), { recursive: true })

  const targets = await detectPatchTargets([
    {
      id: 'fycyc919x-efb-zh-cn',
      targetKind: 'addon-inject',
      targetFolders: ['fycyc-aircraft-c919x'],
      dualSim: { slots: [{ slot: 'msfs2024', communityFolder: 'Community' }] }
    }
  ], { packageRoots: [{ packageRoot, source: 'Steam / MSFS 2024' }] })

  assert.equal(targets['fycyc919x-efb-zh-cn'].targetPath, path.join(packageRoot, 'Community2024', 'fycyc-aircraft-c919x'))
  await fs.rm(root, { recursive: true, force: true })
})

test('injective patch still prefers the configured Community folder when the vendor lives there', async () => {
  const root = await temporaryDirectory('injective-community-first-')
  const packageRoot = path.join(root, 'packages')
  await fs.mkdir(path.join(packageRoot, 'Community2024', 'some-other-addon'), { recursive: true })
  await fs.mkdir(path.join(packageRoot, 'Community', 'ifly-aircraft-737max8', 'html_ui'), { recursive: true })

  const targets = await detectPatchTargets([
    {
      id: 'ifly737max-efb-zh-cn',
      targetKind: 'addon-inject',
      targetFolders: ['ifly-aircraft-737max8'],
      dualSim: { slots: [{ slot: 'msfs2024', communityFolder: 'Community' }] }
    }
  ], { packageRoots: [{ packageRoot, source: 'Steam / MSFS 2024' }] })

  assert.equal(targets['ifly737max-efb-zh-cn'].targetPath, path.join(packageRoot, 'Community', 'ifly-aircraft-737max8'))
  await fs.rm(root, { recursive: true, force: true })
})
