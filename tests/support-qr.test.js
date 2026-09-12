const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('loads the support QR from a single https remote source', async () => {
  const { SUPPORT_QR_SOURCES } = await import('../src/lib/support-qr.mjs')

  assert.equal(SUPPORT_QR_SOURCES.length, 1)
  assert.equal(SUPPORT_QR_SOURCES[0].source, 'github')
  assert.match(SUPPORT_QR_SOURCES[0].url, /^https:\/\/raw\.githubusercontent\.com\//)
})

test('permits the trusted remote QR image hosts in the renderer CSP', async () => {
  const { SUPPORT_QR_SOURCES } = await import('../src/lib/support-qr.mjs')
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

  for (const entry of SUPPORT_QR_SOURCES) {
    const host = new URL(entry.url).hostname
    assert.match(indexHtml, new RegExp(`img-src[^\\n]*https://${host.replaceAll('.', '\\.')}`))
  }
})
