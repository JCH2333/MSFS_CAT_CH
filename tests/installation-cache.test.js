const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  InstallationTargetCache,
  computeDescriptorSignature,
  findMissingTargetPaths,
  normalizeCachedTargets,
  recordInstalledTarget,
  resolveDetectedTargets
} = require('../electron/installation-cache')

function descriptors(patches) {
  return patches
}

test('descriptor signature covers detection-relevant fields only', () => {
  const base = [{ id: 'gsx-pro-zh-cn', targetKind: 'gsx-combined', targetFolders: ['fsdreamteam-gsx-pro'], dualSim: null }]
  const same = [{ id: 'gsx-pro-zh-cn', targetKind: 'gsx-combined', targetFolders: ['fsdreamteam-gsx-pro'], dualSim: null, version: '1.2.10', name: 'other' }]
  assert.equal(computeDescriptorSignature(base), computeDescriptorSignature(same))

  const changedFolders = [{ id: 'gsx-pro-zh-cn', targetKind: 'gsx-combined', targetFolders: ['other-folder'], dualSim: null }]
  const changedSlots = [{ id: 'gsx-pro-zh-cn', targetKind: 'gsx-combined', targetFolders: ['fsdreamteam-gsx-pro'], dualSim: { slots: [] } }]
  const addedPatch = [...base, { id: 'inia350-efb-zh-cn', targetKind: 'addon', targetFolders: [], dualSim: { slots: [] } }]
  assert.notEqual(computeDescriptorSignature(base), computeDescriptorSignature(changedFolders))
  assert.notEqual(computeDescriptorSignature(base), computeDescriptorSignature(changedSlots))
  assert.notEqual(computeDescriptorSignature(base), computeDescriptorSignature(addedPatch))
  assert.equal(computeDescriptorSignature(null), '[]')
})

test('normalizes cached targets and drops invalid entries', () => {
  const targets = normalizeCachedTargets({
    good: { targetPath: 'C:/community/gsx', source: 'Steam / MSFS 2024', slots: [{ slot: 'msfs2024', targetPath: 'C:/c24' }, { slot: '', targetPath: 'x' }] },
    empty: { targetPath: '  ' },
    junk: 'nope'
  })
  assert.deepEqual(targets, {
    good: { targetPath: 'C:/community/gsx', source: 'Steam / MSFS 2024', slots: [{ slot: 'msfs2024', targetPath: 'C:/c24' }] }
  })
  assert.deepEqual(normalizeCachedTargets(null), {})
  assert.deepEqual(normalizeCachedTargets([1]), {})
})

test('findMissingTargetPaths reports missing primary and slot directories', async () => {
  const existing = ['C:/a', 'C:/b']
  const isDirectory = async (candidate) => existing.includes(candidate)
  const targets = {
    dual: { targetPath: 'C:/a', slots: [{ slot: 'msfs2024', targetPath: 'C:/b' }, { slot: 'msfs2020', targetPath: 'C:/gone' }] },
    gone: { targetPath: 'C:/missing' }
  }
  assert.deepEqual(await findMissingTargetPaths(targets, isDirectory), ['C:/gone', 'C:/missing'])
  assert.deepEqual(await findMissingTargetPaths({ ok: { targetPath: 'C:/a' } }, isDirectory), [])
})

test('resolveDetectedTargets reuses the cache when signature matches and directories exist', async () => {
  let detections = 0
  const cache = {
    async read() {
      return { signature: computeDescriptorSignature([{ id: 'a' }]), targets: { a: { targetPath: 'C:/a', source: 'x' } } }
    },
    async write() {
      throw new Error('cache hit must not rewrite')
    }
  }
  const result = await resolveDetectedTargets({
    patches: [{ id: 'a' }],
    cache,
    detect: async () => { detections += 1; return {} },
    isDirectory: async () => true
  })
  assert.equal(result.fromCache, true)
  assert.deepEqual(result.targets, { a: { targetPath: 'C:/a', source: 'x' } })
  assert.equal(detections, 0)
})

test('resolveDetectedTargets re-detects and rewrites when the cache is stale', async () => {
  const writes = []
  let cachePayload = { schemaVersion: 1, signature: 'old', targets: { a: { targetPath: 'C:/old', source: '' } } }
  const cache = {
    async read() { return cachePayload },
    async write(signature, targets) { writes.push({ signature, targets }); cachePayload = { schemaVersion: 1, signature, targets } }
  }
  const first = await resolveDetectedTargets({
    patches: [{ id: 'a' }],
    cache,
    detect: async () => ({ a: { targetPath: 'C:/new', source: 'Steam' } }),
    isDirectory: async (candidate) => candidate === 'C:/new'
  })
  assert.equal(first.fromCache, false)
  assert.deepEqual(first.targets, { a: { targetPath: 'C:/new', source: 'Steam' } })
  assert.equal(writes.length, 1)

  const second = await resolveDetectedTargets({
    patches: [{ id: 'a' }],
    cache,
    detect: async () => { throw new Error('fresh cache must not re-detect') },
    isDirectory: async (candidate) => candidate === 'C:/new'
  })
  assert.equal(second.fromCache, true)
  assert.equal(writes.length, 1)

  const forced = await resolveDetectedTargets({
    patches: [{ id: 'a' }],
    force: true,
    cache,
    detect: async () => ({ a: { targetPath: 'C:/newer', source: 'Steam' } }),
    isDirectory: async () => true
  })
  assert.equal(forced.fromCache, false)
  assert.equal(writes.length, 2)
})

test('InstallationTargetCache round-trips through disk and tolerates corruption', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'install-cache-'))
  const cache = new InstallationTargetCache({ filePath: path.join(directory, 'installation-targets.json') })
  assert.equal(await cache.read(), null)

  await cache.write(computeDescriptorSignature([{ id: 'a' }]), { a: { targetPath: 'C:/x', source: 'y' } })
  const loaded = await cache.read()
  assert.equal(loaded.signature, computeDescriptorSignature([{ id: 'a' }]))
  assert.deepEqual(loaded.targets, { a: { targetPath: 'C:/x', source: 'y' } })
  assert.ok(loaded.savedAt)

  await fs.writeFile(path.join(directory, 'installation-targets.json'), '{broken', 'utf8')
  assert.equal(await cache.read(), null)
  await fs.rm(directory, { recursive: true, force: true })
})

test('recordInstalledTarget writes the installed primary and slots into the cache', async () => {
  let payload = { schemaVersion: 1, signature: 'sig-1', targets: { voice: { targetPath: '', source: '' } } }
  const cache = {
    async read() { return payload.targets.voice && payload.targets.voice.targetPath === '' ? { signature: payload.signature, targets: {} } : { signature: payload.signature, targets: payload.targets } },
    async write(signature, targets) { payload = { schemaVersion: 1, signature, targets } }
  }
  const recorded = await recordInstalledTarget({
    patchId: 'voice',
    targetPath: 'C:/Addon Manager/couatl/GSX',
    slots: [{ slot: 'msfs2024', targetPath: 'C:/c24' }],
    cache
  })
  assert.equal(recorded, true)
  assert.deepEqual(payload.targets.voice, {
    targetPath: 'C:/Addon Manager/couatl/GSX',
    source: '已安装补丁',
    slots: [{ slot: 'msfs2024', targetPath: 'C:/c24' }]
  })

  assert.equal(await recordInstalledTarget({ patchId: '', targetPath: 'C:/x', cache }), false)
  assert.equal(await recordInstalledTarget({ patchId: 'voice', targetPath: '  ', cache }), false)
  assert.equal(await recordInstalledTarget({ patchId: 'voice', targetPath: 'C:/x', cache: null }), false)
})
