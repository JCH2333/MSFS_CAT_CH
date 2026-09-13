const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function source(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
}

test('displays the add-on version on the Chinese voice package like the text patch', () => {
  const card = source('src', 'components', 'PatchCard.vue')
  const settings = source('src', 'views', 'SettingsView.vue')

  assert.match(card, /const showAddonVersion = computed\(\(\) => Boolean\(props\.patch\.addonVersion\)\)/)
  assert.match(card, /<span v-if="showAddonVersion">/)
  assert.doesNotMatch(settings, /patch\.id === 'gsx-pro-zh-cn-voice'/)
  assert.match(settings, /patch\.addonVersion \? `插件 v\$\{patch\.addonVersion\}` : '插件版本未声明'\} · 补丁 v\$\{patch\.version\}/)
})
