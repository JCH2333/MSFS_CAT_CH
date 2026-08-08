const test = require('node:test')
const assert = require('node:assert/strict')
const { validateCatalog } = require('../electron/github-catalog')

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

test('keeps legacy cached catalogs readable when add-on version metadata is absent', () => {
  const result = validateCatalog(catalogWith({
    id: 'legacy-patch',
    name: 'Legacy Patch',
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
