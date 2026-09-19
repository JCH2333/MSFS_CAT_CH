const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function source(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
}

test('voice package shows 全版本适配 when the server no longer pins an add-on version', () => {
  const card = source('src', 'components', 'PatchCard.vue')
  const settings = source('src', 'views', 'SettingsView.vue')

  // 语音包 addonVersion 置空后（适配全部 GSX 版本），卡片显示"全版本适配"而非具体版本
  assert.match(card, /const addonVersionLabel = computed\(\(\) => \{/)
  assert.match(card, /props\.patch\.targetKind === 'gsx-audio' \? '插件 全版本适配' : ''/)
  assert.match(card, /<span v-if="addonVersionLabel">/)
  assert.doesNotMatch(settings, /patch\.id === 'gsx-pro-zh-cn-voice'/)
  assert.match(settings, /patch\.addonVersion \? `插件 v\$\{patch\.addonVersion\}` : '插件版本未声明'\} · 补丁 v\$\{patch\.version\}/)
})
