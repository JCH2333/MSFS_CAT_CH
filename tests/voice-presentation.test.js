const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function source(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
}

test('does not display the GSX add-on version on the Chinese voice package', () => {
  const card = source('src', 'components', 'PatchCard.vue')
  const settings = source('src', 'views', 'SettingsView.vue')

  assert.match(card, /const showAddonVersion = computed\(\(\) => Boolean\(props\.patch\.addonVersion\) && !isNetworkAuthored\.value\)/)
  assert.match(card, /<span v-if="showAddonVersion">/)
  assert.match(settings, /patch\.id === 'gsx-pro-zh-cn-voice'\) return `补丁 v\$\{patch\.version\}`/)
})
