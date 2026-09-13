const test = require('node:test')
const assert = require('node:assert/strict')
const {
  DEFAULT_SERVER_ORIGIN,
  SERVER_ORIGIN,
  SERVER_HOSTNAME,
  buildServerUrl,
  isTrustedServerUrl,
  normalizeOrigin,
  serverOriginProtocol
} = require('../electron/distribution-server')

const MODULE_PATH = require.resolve('../electron/distribution-server')

test('defaults to the transitional IP origin until the domain is filed', () => {
  assert.equal(DEFAULT_SERVER_ORIGIN, 'http://47.109.31.236:20075')
  assert.equal(SERVER_ORIGIN, 'http://47.109.31.236:20075')
  assert.equal(SERVER_HOSTNAME, '47.109.31.236')
  assert.equal(serverOriginProtocol(), 'http:')
  assert.equal(buildServerUrl('/api/catalog/manifest.json'), 'http://47.109.31.236:20075/api/catalog/manifest.json')
})

test('normalizes origins by lowercasing hosts, stripping default ports and trailing slashes', () => {
  assert.equal(normalizeOrigin('HTTPS://JianchiHu.Online/'), 'https://jianchihu.online')
  assert.equal(normalizeOrigin('https://jianchihu.online:443/'), 'https://jianchihu.online')
  assert.equal(normalizeOrigin('http://47.109.31.236:80/'), 'http://47.109.31.236')
  assert.equal(normalizeOrigin('http://47.109.31.236:20075'), 'http://47.109.31.236:20075')
  assert.equal(normalizeOrigin('ftp://example.com'), null)
  assert.equal(normalizeOrigin('not a url'), null)
  assert.equal(normalizeOrigin(''), null)
  assert.equal(normalizeOrigin(null), null)
})

test('isTrustedServerUrl requires the exact configured origin', () => {
  assert.equal(isTrustedServerUrl('http://47.109.31.236:20075/downloads/software/latest.yml'), true)
  assert.equal(isTrustedServerUrl('http://47.109.31.236:20075.evil.example/latest.yml'), false)
  assert.equal(isTrustedServerUrl('http://47.109.31.236:9999/latest.yml'), false)
  assert.equal(isTrustedServerUrl('https://gitee.com/x'), false)
  assert.equal(isTrustedServerUrl('not a url'), false)
})

test('honors the MSFS_CAT_CH_SERVER_ORIGIN override (domain testing after filing)', () => {
  const previous = process.env.MSFS_CAT_CH_SERVER_ORIGIN
  try {
    process.env.MSFS_CAT_CH_SERVER_ORIGIN = 'https://jianchihu.online/'
    delete require.cache[MODULE_PATH]
    const server = require('../electron/distribution-server')

    assert.equal(server.SERVER_ORIGIN, 'https://jianchihu.online')
    assert.equal(server.SERVER_HOSTNAME, 'jianchihu.online')
    assert.equal(server.serverOriginProtocol(), 'https:')
    assert.equal(server.buildServerUrl('/api/catalog/manifest.json'), 'https://jianchihu.online/api/catalog/manifest.json')
    assert.equal(server.isTrustedServerUrl('https://jianchihu.online/api/patches/download/x'), true)
    assert.equal(server.isTrustedServerUrl('http://47.109.31.236:20075/api/patches/download/x'), false)
  } finally {
    if (previous === undefined) delete process.env.MSFS_CAT_CH_SERVER_ORIGIN
    else process.env.MSFS_CAT_CH_SERVER_ORIGIN = previous
    delete require.cache[MODULE_PATH]
  }
})
