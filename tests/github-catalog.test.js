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
    status: 'published',
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
})

test('allows planned patches without a package', () => {
  const result = validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '0.0.0',
    status: 'planned'
  }))
  assert.equal(result.patches[0].package, null)
})

test('rejects published patches with an invalid checksum', () => {
  assert.throws(() => validateCatalog(catalogWith({
    id: 'gsx-pro-zh-cn',
    name: 'GSX Pro 简体中文',
    version: '1.0.0',
    status: 'published',
    package: {
      releaseTag: 'gsx-pro-v1.0.0',
      assetName: 'patch.zip',
      sha256: 'not-a-sha'
    }
  })), /SHA-256/)
})

test('rejects duplicate patch ids', () => {
  const patch = { id: 'same', name: 'Same', version: '1.0.0', status: 'planned' }
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
    status: 'planned'
  })), /语义化/)
})
