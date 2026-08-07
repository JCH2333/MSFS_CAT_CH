const test = require('node:test')
const assert = require('node:assert/strict')
const { compareVersions, isSemanticVersion } = require('../electron/versioning')

test('compares semantic patch versions in numeric order', () => {
  assert.equal(compareVersions('1.10.0', '1.2.0'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
})

test('accepts semantic versions and rejects ambiguous labels', () => {
  assert.equal(isSemanticVersion('v1.2.3'), true)
  assert.equal(isSemanticVersion('1.2.3-beta.1'), true)
  assert.equal(isSemanticVersion('latest'), false)
})
