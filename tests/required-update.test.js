const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectFile = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')

test('checks for updates automatically after subscribing to update status', () => {
  const source = projectFile('src', 'App.vue')
  const subscribeIndex = source.indexOf('unsubscribeUpdates = bridge.updates.onStatus')
  const startupCheckIndex = source.indexOf('void checkUpdate()')

  assert.ok(subscribeIndex >= 0)
  assert.ok(startupCheckIndex > subscribeIndex)
})

test('requires an available update to be downloaded and installed without a close or cancel action', () => {
  const source = projectFile('src', 'components', 'RequiredUpdateDialog.vue')

  assert.match(source, /updateStatus\.state === 'available'/)
  assert.match(source, /updateStatus\.state === 'downloaded'/)
  assert.doesNotMatch(source, /\$emit\('close'\)|取消更新|暂不更新|稍后更新/)
})

test('does not keep a duplicate main-process startup update check', () => {
  const source = projectFile('electron', 'main.js')

  assert.doesNotMatch(source, /setTimeout\(\(\) => checkForSoftwareUpdates\(\)\.catch\(\(\) => \{\}\), 1500\)/)
})
