const test = require('node:test')
const assert = require('node:assert/strict')
const { assessGsxPatchVersion } = require('../src/lib/gsx-version-guard.mjs')

test('assessGsxPatchVersion compares the installed GSX against the patch target in both directions', () => {
  assert.equal(assessGsxPatchVersion('4.0.23', '4.0.23'), 'ok')
  assert.equal(assessGsxPatchVersion('4.0.21', '4.0.23'), 'gsx-older')
  // 高于适配版本必须拦截：旧补丁会覆盖新版本的版本标记与面板文件
  // （2026-09 v1.2.8 在 4.0.23 上覆盖 manifest，客户端误报"幽灵 4.0.21"）
  assert.equal(assessGsxPatchVersion('4.0.23', '4.0.21'), 'gsx-newer')
  assert.equal(assessGsxPatchVersion('4.1.0', '4.0.23'), 'gsx-newer')
})

test('assessGsxPatchVersion stays permissive when versions are missing or unparsable', () => {
  assert.equal(assessGsxPatchVersion(null, '4.0.23'), 'ok')
  assert.equal(assessGsxPatchVersion('4.0.23', ''), 'ok')
  assert.equal(assessGsxPatchVersion('not-a-version', '4.0.23'), 'ok')
  assert.equal(assessGsxPatchVersion('4.0.23', 'latest'), 'ok')
})
