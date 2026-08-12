const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('loads the support QR from Gitee before fallback sources', async () => {
  const { SUPPORT_QR_SOURCES } = await import('../src/lib/support-qr.mjs')

  assert.equal(SUPPORT_QR_SOURCES[0].source, 'gitee')
  assert.match(SUPPORT_QR_SOURCES[0].url, /^https:\/\/gitee\.com\/ljd123456\/MSFS_CAT_CH\/raw\/main\//)
  assert.deepEqual(SUPPORT_QR_SOURCES.map((entry) => entry.source), ['gitee', 'github', 'mirror'])
  assert.ok(SUPPORT_QR_SOURCES.every((entry) => entry.url.startsWith('https://')))
})

test('permits the trusted remote QR image hosts in the renderer CSP', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

  for (const host of ['gitee.com', 'raw.giteeusercontent.com', 'raw.githubusercontent.com', 'ghfast.top']) {
    assert.match(indexHtml, new RegExp(`img-src[^\\n]*https://${host.replaceAll('.', '\\.')}`))
  }
})
