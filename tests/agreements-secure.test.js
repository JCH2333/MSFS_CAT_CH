const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const {
  AGREEMENT_SIGNING_PUBLIC_KEY,
  AGREEMENT_TEXT_SHA256,
  LATEST_REVISION_ENDPOINT_PATH,
  TEXT_KEY_ENDPOINT_BASE,
  checkAgreementUpdate,
  clearAgreementTextCache,
  getAgreementText,
  joinAgreementHash,
  loadEmbeddedBundle,
  validateEncryptedBundle,
  verifyBundleSignature
} = require('../electron/agreements-secure')
const { SERVER_ORIGIN } = require('../electron/distribution-server')

const TEST_KEY = crypto.randomBytes(32)
// 测试专用签名密钥对：与内嵌公钥无关，通过 signingPublicKey 注入远程校验路径
const TEST_SIGNING = crypto.generateKeyPairSync('ed25519')
const TEST_SIGNING_PUBLIC_PEM = TEST_SIGNING.publicKey.export({ type: 'spki', format: 'pem' }).trim()
const TEST_SIGNING_PRIVATE = TEST_SIGNING.privateKey
const USER_BODY = '用户使用协议全文\n第二行'
const NOTICE_BODY = '免责声明全文'
const FIXTURE_SHA256 = joinAgreementHash([USER_BODY, NOTICE_BODY])
const FIXTURE_REVISION = '2026-09-15-v1'

function signFixture(revision, sha256, privateKey = TEST_SIGNING_PRIVATE) {
  return crypto.sign(null, Buffer.from(`legal-agreement-v1:${revision}:${sha256}`, 'utf8'), privateKey).toString('base64')
}

function encryptBundle(plaintextSource, { key = TEST_KEY, revision = FIXTURE_REVISION, sha256, signature } = {}) {
  const entries = Array.isArray(plaintextSource) ? plaintextSource : null
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(entries || plaintextSource), 'utf8'), cipher.final()])
  const bundle = {
    revision,
    algorithm: 'aes-256-gcm',
    nonce: nonce.toString('base64'),
    payload: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64'),
    sha256: sha256 || joinAgreementHash(entries ? entries.map((entry) => entry.body) : ['占位'])
  }
  if (signature !== null) {
    bundle.signatureAlgorithm = 'ed25519'
    bundle.signature = signature === undefined ? signFixture(bundle.revision, bundle.sha256) : signature
  }
  return bundle
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
  assert.equal(bundle.revision, '2026-09-17-v1')
  assert.equal(bundle.algorithm, 'aes-256-gcm')
  assert.equal(bundle.sha256, AGREEMENT_TEXT_SHA256, '内嵌密文的存证哈希必须等于 pinned 常量')
  // 内置包同样携带作者签名：使用内嵌公钥验签必须通过（防公钥/私钥漂移）
  assert.equal(verifyBundleSignature(bundle), true, '内置密文包必须通过内嵌公钥验签')
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

test('verifyBundleSignature accepts only author signatures over revision and hash', () => {
  const revision = '2027-01-01-v1'
  const sha256 = FIXTURE_SHA256
  const good = { revision, sha256, signatureAlgorithm: 'ed25519', signature: signFixture(revision, sha256) }
  assert.equal(verifyBundleSignature(good, TEST_SIGNING_PUBLIC_PEM), true)

  // 换用内嵌公钥必须失败：签名不匹配时绝不放行
  assert.equal(verifyBundleSignature(good), false)

  // 修订号或哈希任一被篡改，验签必须失败
  assert.equal(verifyBundleSignature({ ...good, revision: '2027-01-02-v1' }, TEST_SIGNING_PUBLIC_PEM), false)
  assert.equal(verifyBundleSignature({ ...good, sha256: 'f'.repeat(64) }, TEST_SIGNING_PUBLIC_PEM), false)

  // 缺签名、坏算法、坏 base64、非法修订号一律拒绝
  assert.equal(verifyBundleSignature({ revision, sha256 }, TEST_SIGNING_PUBLIC_PEM), false)
  assert.equal(verifyBundleSignature({ ...good, signatureAlgorithm: 'rsa' }, TEST_SIGNING_PUBLIC_PEM), false)
  assert.equal(verifyBundleSignature({ ...good, signature: '!!' }, TEST_SIGNING_PUBLIC_PEM), false)
  assert.equal(verifyBundleSignature({ ...good, revision: '../evil' }, TEST_SIGNING_PUBLIC_PEM), false)
  assert.equal(verifyBundleSignature(null, TEST_SIGNING_PUBLIC_PEM), false)
})

function remoteFetchStub({ latestBody, bundle, keyBody, calls = [] }) {
  return async (url) => {
    calls.push(String(url))
    if (String(url) === `${SERVER_ORIGIN}${LATEST_REVISION_ENDPOINT_PATH}`) {
      return { ok: true, status: 200, json: async () => latestBody }
    }
    if (String(url).startsWith(`${SERVER_ORIGIN}/api/legal/bundle/`)) {
      return { ok: true, status: 200, json: async () => bundle }
    }
    if (String(url).startsWith(`${SERVER_ORIGIN}${TEXT_KEY_ENDPOINT_BASE}/`)) {
      return { ok: true, status: 200, json: async () => keyBody }
    }
    return { ok: false, status: 404, json: async () => ({ code: 404 }) }
  }
}

const REMOTE_BODIES = [{ id: 'user', body: USER_BODY }, { id: 'notice', body: NOTICE_BODY }]

function remoteFixtures({ revision = '2027-01-01-v1', sha256 = FIXTURE_SHA256, signature } = {}) {
  const bundle = encryptBundle(REMOTE_BODIES, { revision, sha256, signature })
  return {
    bundle,
    latestBody: { code: 200, data: { revision, agreementSha256: sha256 } },
    keyBody: { code: 200, data: { key: TEST_KEY.toString('base64') } }
  }
}

test('checkAgreementUpdate reports upToDate when the accepted revision is latest', async () => {
  const { latestBody } = remoteFixtures({ revision: '2026-09-17-v1' })
  const calls = []
  const result = await checkAgreementUpdate({
    acceptedRevision: '2026-09-17-v1',
    signingPublicKey: TEST_SIGNING_PUBLIC_PEM,
    fetchImpl: remoteFetchStub({ latestBody, bundle: null, keyBody: null, calls })
  })
  assert.deepEqual(result, { ok: true, upToDate: true, revision: '2026-09-17-v1' })
  assert.deepEqual(calls, [`${SERVER_ORIGIN}${LATEST_REVISION_ENDPOINT_PATH}`], '已是最新时不得下载正文')
})

test('checkAgreementUpdate fetches, verifies and returns the pushed revision', async () => {
  const fixtures = remoteFixtures()
  const calls = []
  const result = await checkAgreementUpdate({
    acceptedRevision: '2026-09-17-v1',
    signingPublicKey: TEST_SIGNING_PUBLIC_PEM,
    fetchImpl: remoteFetchStub({ ...fixtures, calls })
  })
  assert.equal(result.ok, true)
  assert.equal(result.upToDate, false)
  assert.equal(result.revision, '2027-01-01-v1')
  assert.equal(result.textSha256, FIXTURE_SHA256)
  assert.deepEqual(result.agreements, REMOTE_BODIES)
  assert.deepEqual(calls, [
    `${SERVER_ORIGIN}${LATEST_REVISION_ENDPOINT_PATH}`,
    `${SERVER_ORIGIN}/api/legal/bundle/2027-01-01-v1`,
    `${SERVER_ORIGIN}${TEXT_KEY_ENDPOINT_BASE}/2027-01-01-v1`
  ])
})

test('checkAgreementUpdate fails closed on tampered or unsigned pushes', async () => {
  // 未签名的密文包：拒绝
  const unsigned = remoteFixtures({ signature: null })
  const unsignedResult = await checkAgreementUpdate({
    acceptedRevision: '2026-09-17-v1',
    signingPublicKey: TEST_SIGNING_PUBLIC_PEM,
    fetchImpl: remoteFetchStub(unsigned)
  })
  assert.deepEqual(unsignedResult, { ok: false, error: 'bad-bundle' })

  // 签名与 revision/hash 不匹配（攻击者把旧签名嫁接到新哈希上）：拒绝
  const reattached = remoteFixtures({ revision: '2027-02-01-v1', signature: signFixture('2027-01-01-v1', FIXTURE_SHA256) })
  const reattachedResult = await checkAgreementUpdate({
    acceptedRevision: '2026-09-17-v1',
    signingPublicKey: TEST_SIGNING_PUBLIC_PEM,
    fetchImpl: remoteFetchStub(reattached)
  })
  assert.equal(reattachedResult.ok, false)
  assert.equal(JSON.stringify(reattachedResult).includes(USER_BODY), false, '拒绝路径绝不能携带明文')

  // latest-revision 声明的哈希与密文包不一致：拒绝
  const lyingLatest = remoteFixtures()
  lyingLatest.latestBody = { code: 200, data: { revision: '2027-01-01-v1', agreementSha256: 'a'.repeat(64) } }
  const lyingResult = await checkAgreementUpdate({
    acceptedRevision: '2026-09-17-v1',
    signingPublicKey: TEST_SIGNING_PUBLIC_PEM,
    fetchImpl: remoteFetchStub(lyingLatest)
  })
  assert.deepEqual(lyingResult, { ok: false, error: 'revision-mismatch' })

  // 网络失败：ok:false，不抛异常
  const offline = await checkAgreementUpdate({
    acceptedRevision: '2026-09-17-v1',
    fetchImpl: async () => { throw new Error('offline') }
  })
  assert.deepEqual(offline, { ok: false, error: 'network-error' })
})
