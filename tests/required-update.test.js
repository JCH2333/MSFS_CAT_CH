const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectFile = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')

test('reads the main-process update state after subscribing to update status', () => {
  const source = projectFile('src', 'App.vue')
  const subscribeIndex = source.indexOf('unsubscribeUpdates = bridge.updates.onStatus')
  const startupStatusIndex = source.indexOf('await bridge.updates.status()')

  assert.ok(subscribeIndex >= 0)
  assert.ok(startupStatusIndex > subscribeIndex)
})

test('starts the required update flow automatically without renderer actions', () => {
  const main = projectFile('electron', 'main.js')
  const source = projectFile('src', 'components', 'RequiredUpdateDialog.vue')

  assert.match(main, /void startRequiredSoftwareUpdate\(\)/)
  assert.match(main, /autoUpdater\.quitAndInstall\(false, true\)/)
  assert.match(source, /正在自动开始更新/)
  assert.doesNotMatch(source, /\$emit\('download'\)|\$emit\('install'\)/)
  assert.doesNotMatch(source, /\$emit\('close'\)|取消更新|暂不更新|稍后更新/)
})

test('does not keep a duplicate main-process startup update check', () => {
  const source = projectFile('electron', 'main.js')

  assert.doesNotMatch(source, /setTimeout\(\(\) => checkForSoftwareUpdates\(\)\.catch\(\(\) => \{\}\), 1500\)/)
})
