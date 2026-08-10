const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { GitHubCatalog, validateCatalog } = require('../electron/github-catalog')

function catalogWith(patch) {
  return {
    schemaVersion: 1,
    catalogVersion: '2026.08.06',
    updatedAt: '2026-08-06T00:00:00Z',
    patches: [patch]
  }
}

test('validates and derives a GitHub release asset URL', () => {
  const result = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    summary: 'Test patch',
    version: '1.0.0',
    addonVersion: '4.0.14',
    status: 'published',
    fingerprint: [{ relativePath: 'html_ui/panel.js', sha256: 'b'.repeat(64) }],
    compatibility: ['MSFS 2024'],
    package: {
      releaseTag: 'gsx-pro-v1.0.0',
      assetName: 'gsx-pro-zh-cn.zip',
      sha256: 'a'.repeat(64),
      size: 100
    }
  }))

  assert.equal(result.patches[0].package.downloadUrl,
    'https://github.com/JCH2333/MSFS_CAT_CH_PATCHES/releases/download/gsx-pro-v1.0.0/gsx-pro-zh-cn.zip')
  assert.equal(result.patches[0].addonVersion, '4.0.14')
  assert.deepEqual(result.patches[0].fingerprint, [{ relativePath: 'html_ui/panel.js', sha256: 'b'.repeat(64) }])
})

test('allows planned patches without a package', () => {
  const result = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '0.0.0',
    addonVersion: '4.0.14',
    status: 'planned'
  }))
  assert.equal(result.patches[0].package, null)
})

test('keeps the GSX voice package target kind for safe audio installation', () => {
  const result = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn-voice',
    name: 'GSX 中文语音包',
    version: '1.0.0',
    addonVersion: '4.0.15',
    status: 'planned',
    targetKind: 'gsx-audio'
  }))
  assert.equal(result.patches[0].targetKind, 'gsx-audio')
})

test('shows only the supported GSX patch when a cached catalog contains retired patches', () => {
  const gsx = {
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro',
    version: '1.2.0',
    addonVersion: '4.0.15',
    status: 'planned'
  }
  const retired = {
    id: 'fsrealistic-plus-zh-cn',
    name: 'FSRealistic+',
    version: '1.1.0',
    addonVersion: '1.1.9',
    status: 'withdrawn'
  }
  const result = validateCatalog({
    schemaVersion: 1,
    catalogVersion: '2026.08.09',
    updatedAt: '2026-08-09T00:00:00Z',
    patches: [gsx, retired]
  })
  assert.deepEqual(result.patches.map((patch) => patch.id), ['gsx-pro-zh-cn'])
})

test('keeps legacy cached catalogs readable when add-on version metadata is absent', () => {
  const result = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro',
    version: '1.0.0',
    status: 'planned'
  }))
  assert.equal(result.patches[0].addonVersion, null)
})

test('rejects published patches with an invalid checksum', () => {
  assert.throws(() => validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '1.0.0',
    addonVersion: '4.0.14',
    status: 'published',
    package: {
      releaseTag: 'gsx-pro-v1.0.0',
      assetName: 'patch.zip',
      sha256: 'not-a-sha'
    }
  })), /SHA-256/)
})

test('rejects duplicate patch ids', () => {
  const patch = { id: 'same', name: 'Same', version: '1.0.0', addonVersion: '4.0.14', status: 'planned' }
  assert.throws(() => validateCatalog({
    schemaVersion: 1,
    catalogVersion: '1',
    updatedAt: 'now',
    patches: [patch, patch]
  }), /重复/)
})

test('rejects a patch version that is not semantic versioning', () => {
  assert.throws(() => validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: 'latest',
    addonVersion: '4.0.14',
    status: 'planned'
  })), /语义化/)
})

test('rejects a patch add-on version that is not semantic versioning', () => {
  assert.throws(() => validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '1.0.0',
    addonVersion: 'current',
    status: 'planned'
  })), /addonVersion/)
})

test('rejects unsafe patch fingerprint paths', () => {
  assert.throws(() => validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro',
    version: '1.0.0',
    addonVersion: '4.0.14',
    status: 'planned',
    fingerprint: [{ relativePath: '../outside.js', sha256: 'a'.repeat(64) }]
  })), /fingerprint/)
})

test('uses the domestic mirror only after a GitHub catalog timeout', async () => {
  const calls = []
  const catalog = catalogWith({ id: 'mirror-patch', name: 'Mirror Patch', version: '1.0.0', addonVersion: '1.0.0', status: 'planned' })
  const fetchImpl = async (url) => {
    calls.push(url)
    if (calls.length === 1) {
      const error = new Error('GitHub timed out')
      error.code = 'ETIMEDOUT'
      throw error
    }
    return { ok: true, json: async () => catalog }
  }
  const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-mirror-'))
  const client = new GitHubCatalog({ cacheDirectory, fetchImpl })

  const result = await client.refresh()

  assert.equal(result.source, 'mirror')
  assert.equal(calls.length, 2)
  assert.match(calls[1], /^https:\/\/ghfast\.top\/https:\/\/raw\.githubusercontent\.com\//)
  await fs.rm(cacheDirectory, { recursive: true, force: true })
})
