const test = require('node:test')
const assert = require('node:assert/strict')
const { assessGsxPatchVersion, guardDialogVariant } = require('../src/lib/gsx-version-guard.mjs')

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

test('guardDialogVariant maps the newer verdict to the newer dialog form', () => {
  // 2.2.0 事故回归：'gsx-newer' 必须映射到 newer 形态，否则较新场景渲染"版本过低"文案
  assert.equal(guardDialogVariant('gsx-newer'), 'newer')
  assert.equal(guardDialogVariant('gsx-older'), 'older')
  assert.equal(guardDialogVariant('ok'), 'older')
})
