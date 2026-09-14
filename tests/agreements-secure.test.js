const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const {
  AGREEMENT_TEXT_SHA256,
  TEXT_KEY_ENDPOINT_BASE,
  clearAgreementTextCache,
  getAgreementText,
  joinAgreementHash,
  loadEmbeddedBundle,
  validateEncryptedBundle
} = require('../electron/agreements-secure')
const { SERVER_ORIGIN } = require('../electron/distribution-server')

const TEST_KEY = crypto.randomBytes(32)
const USER_BODY = '用户使用协议全文\n第二行'
const NOTICE_BODY = '免责声明全文'
const FIXTURE_SHA256 = joinAgreementHash([USER_BODY, NOTICE_BODY])

function encryptBundle(plaintextSource, { key = TEST_KEY, revision = '2026-09-15-v1', sha256 } = {}) {
  const entries = Array.isArray(plaintextSource) ? plaintextSource : null
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(entries || plaintextSource), 'utf8'), cipher.final()])
  return {
    revision,
    algorithm: 'aes-256-gcm',
    nonce: nonce.toString('base64'),
    payload: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64'),
    sha256: sha256 || joinAgreementHash(entries ? entries.map((entry) => entry.body) : ['占位'])
  }
}

function keyEndpointResponse(body, status = 200) {
  return { ok: status === 200, status, json: async () => body }
}

function keyFetchStub(bundle, { calls = [] } = {}) {
  return async (url) => {
    calls.push(url)
    return keyEndpointResponse({ code: 200, message: 'success', data: { revision: bundle.revision, key: TEST_KEY.toString('base64') } })
  }
}

async function loadFixture(bundle, options = {}) {
  return getAgreementText({
    fetchImpl: options.fetchImpl || keyFetchStub(bundle),
    bundle,
    expectedTextSha256: options.expectedTextSha256 || (bundle && bundle.sha256)
  })
}

test.beforeEach(() => clearAgreementTextCache())
test.afterEach(() => clearAgreementTextCache())

test('embedded bundle is valid and pinned to the archived agreement hash', async () => {
  const bundle = loadEmbeddedBundle()
  const parsed = validateEncryptedBundle(bundle)
  assert.ok(parsed, '内嵌密文包必须通过结构校验')
  assert.equal(bundle.revision, '2026-09-15-v1')
  assert.equal(bundle.algorithm, 'aes-256-gcm')
  assert.equal(bundle.sha256, AGREEMENT_TEXT_SHA256, '内嵌密文的存证哈希必须等于 pinned 常量')
})

test('plaintext source, pinned constants and embedded bundle stay in sync', async () => {
  const { PINNED_AGREEMENT_TEXT_SHA256, agreementTexts } = await import('../tools/agreements-texts.mjs')
  assert.equal(PINNED_AGREEMENT_TEXT_SHA256, AGREEMENT_TEXT_SHA256)
  assert.equal(joinAgreementHash(agreementTexts.map((text) => text.body)), AGREEMENT_TEXT_SHA256)
  assert.equal(loadEmbeddedBundle().sha256, AGREEMENT_TEXT_SHA256)
})

test('validateEncryptedBundle rejects malformed bundles', () => {
  const good = encryptBundle([{ id: 'user', body: USER_BODY }, { id: 'notice', body: NOTICE_BODY }])
  assert.equal(validateEncryptedBundle(null), null)
  assert.equal(validateEncryptedBundle('not-object'), null)
  assert.equal(validateEncryptedBundle({ ...good, revision: '../evil' }), null)
  assert.equal(validateEncryptedBundle({ ...good, algorithm: 'aes-128-gcm' }), null)
  assert.equal(validateEncryptedBundle({ ...good, nonce: 'short' }), null)
  assert.equal(validateEncryptedBundle({ ...good, payload: '!!' }), null)
  assert.equal(validateEncryptedBundle({ ...good, sha256: 'nothex' }), null)
})

test('getAgreementText decrypts the bundle after fetching the server key', async () => {
  const bundle = encryptBundle([{ id: 'user', body: USER_BODY }, { id: 'notice', body: NOTICE_BODY }])
  const calls = []
  const result = await loadFixture(bundle, { fetchImpl: keyFetchStub(bundle, { calls }) })

  assert.deepEqual(result, {
    ok: true,
    revision: '2026-09-15-v1',
    agreements: [{ id: 'user', body: USER_BODY }, { id: 'notice', body: NOTICE_BODY }]
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0], `${SERVER_ORIGIN}${TEXT_KEY_ENDPOINT_BASE}/2026-09-15-v1`)
})

test('getAgreementText caches plaintext in memory and refetches only after reset', async () => {
  const bundle = encryptBundle([{ id: 'user', body: USER_BODY }, { id: 'notice', body: NOTICE_BODY }])
  const calls = []
  const fetchImpl = keyFetchStub(bundle, { calls })

  const first = await loadFixture(bundle, { fetchImpl })
  assert.equal(first.ok, true)
  const second = await loadFixture(bundle, { fetchImpl })
  assert.equal(second.ok, true)
  assert.equal(calls.length, 1, '缓存生效时不得再次请求密钥')

  clearAgreementTextCache()
  const third = await loadFixture(bundle, { fetchImpl })
  assert.equal(third.ok, true)
  assert.equal(calls.length, 2, '清空缓存后必须重新取钥')
})

test('getAgreementText merges concurrent requests into one key fetch', async () => {
  const bundle = encryptBundle([{ id: 'user', body: USER_BODY }, { id: 'notice', body: NOTICE_BODY }])
  const calls = []
  const fetchImpl = keyFetchStub(bundle, { calls })
  const [first, second] = await Promise.all([
    loadFixture(bundle, { fetchImpl }),
    loadFixture(bundle, { fetchImpl })
  ])
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(calls.length, 1)
})

test('getAgreementText maps network and http failures without caching', async () => {
  const bundle = encryptBundle([{ id: 'user', body: USER_BODY }, { id: 'notice', body: NOTICE_BODY }])
  const offline = await loadFixture(bundle, { fetchImpl: async () => { throw new Error('offline') } })
  assert.deepEqual(offline, { ok: false, error: 'network-error' })

  const serverError = await loadFixture(bundle, { fetchImpl: async () => keyEndpointResponse({}, 500) })
  assert.deepEqual(serverError, { ok: false, error: 'http-500' })

  const notFound = await loadFixture(bundle, { fetchImpl: async () => keyEndpointResponse({ code: 404, message: '未知协议修订版' }, 404) })
  assert.deepEqual(notFound, { ok: false, error: 'http-404' })

  const noFetch = await getAgreementText({ fetchImpl: null, bundle, expectedTextSha256: bundle.sha256 })
  assert.deepEqual(noFetch, { ok: false, error: 'fetch-unavailable' })

  // 失败后不留缓存：下一次成功请求仍会发起
  const calls = []
  const recovery = await loadFixture(bundle, { fetchImpl: keyFetchStub(bundle, { calls }) })
  assert.equal(recovery.ok, true)
  assert.equal(calls.length, 1)
})

test('getAgreementText rejects malformed key responses', async () => {
  const bundle = encryptBundle([{ id: 'user', body: USER_BODY }, { id: 'notice', body: NOTICE_BODY }])
  const shortKey = crypto.randomBytes(16).toString('base64')
  const badCode = await loadFixture(bundle, {
    fetchImpl: async () => keyEndpointResponse({ code: 500, message: 'error', data: { key: TEST_KEY.toString('base64') } })
  })
  assert.equal(badCode.ok, false)
  assert.equal(badCode.error, 'bad-code')

  const badKey = await loadFixture(bundle, {
    fetchImpl: async () => keyEndpointResponse({ code: 200, data: { key: shortKey } })
  })
  assert.deepEqual(badKey, { ok: false, error: 'bad-key' })

  const badJson = await loadFixture(bundle, {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json') } })
  })
  assert.deepEqual(badJson, { ok: false, error: 'bad-json' })
})

test('getAgreementText fails closed on decrypt, tampering and plaintext mismatches', async () => {
  const bodies = [{ id: 'user', body: USER_BODY }, { id: 'notice', body: NOTICE_BODY }]
  const wrongKey = await loadFixture(encryptBundle(bodies, { key: crypto.randomBytes(32) }), {
    fetchImpl: async () => keyEndpointResponse({ code: 200, data: { key: TEST_KEY.toString('base64') } })
  })
  assert.deepEqual(wrongKey, { ok: false, error: 'decrypt-failed' })

  const tampered = encryptBundle(bodies)
  const payload = Buffer.from(tampered.payload, 'base64')
  payload[0] ^= 0xff
  const tamperedResult = await loadFixture({ ...tampered, payload: payload.toString('base64') })
  assert.equal(tamperedResult.error, 'decrypt-failed')

  const swappedIds = await loadFixture(encryptBundle([bodies[1], bodies[0]]))
  assert.deepEqual(swappedIds, { ok: false, error: 'bad-plaintext' })

  const notJson = await loadFixture(encryptBundle('not json at all'))
  assert.deepEqual(notJson, { ok: false, error: 'bad-plaintext' })

  // 密文包声明的哈希与 pinned 期望不一致：pinned 校验必须先拦下
  const repinned = encryptBundle(bodies, { sha256: joinAgreementHash([USER_BODY, NOTICE_BODY, 'x']) })
  const repinnedResult = await loadFixture(repinned, { expectedTextSha256: FIXTURE_SHA256 })
  assert.equal(repinnedResult.error, 'sha256-pin-mismatch')

  // 期望哈希被同时篡改（伪装成 pinned）：解密后的存证口径校验必须拦下
  const lyingSha = joinAgreementHash([USER_BODY + '被篡改', NOTICE_BODY])
  const lying = encryptBundle(bodies, { sha256: lyingSha })
  const lyingResult = await loadFixture(lying, { expectedTextSha256: lying.sha256 })
  assert.equal(lyingResult.error, 'sha256-mismatch')

  const badBundle = await loadFixture(null)
  assert.deepEqual(badBundle, { ok: false, error: 'bad-bundle' })
})

test('getAgreementText never throws and surfaces no plaintext on failure', async () => {
  const bundle = encryptBundle([{ id: 'user', body: USER_BODY }, { id: 'notice', body: NOTICE_BODY }])
  const result = await loadFixture(bundle, {
    fetchImpl: async () => { throw new TypeError('sync throw inside fetch') }
  })
  assert.equal(result.ok, false)
  assert.equal(JSON.stringify(result).includes(USER_BODY), false, '失败结果绝不能携带明文')
})
