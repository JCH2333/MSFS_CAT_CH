const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { fetchSponsorQr, SPONSOR_QR_ENDPOINT_PATH } = require('../electron/support-qr')
const { SERVER_ORIGIN } = require('../electron/distribution-server')

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])

const TEST_KEY = crypto.randomBytes(32)
const TEST_KEY_BASE64 = TEST_KEY.toString('base64')

function encryptForTest(plaintext, key = TEST_KEY) {
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    nonce: nonce.toString('base64'),
    payload: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64'),
    sha256: crypto.createHash('sha256').update(plaintext).digest('hex')
  }
}

function fetchReturning(body, status = 200) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    return { status, json: async () => body }
  }
  return { calls, fetchImpl }
}

test('decrypts a valid jpeg payload into a data url with a matching sha256', async () => {
  const encrypted = encryptForTest(JPEG_BYTES)
  const body = { scheme: 'aes-256-gcm', ...encrypted }
  const { calls, fetchImpl } = fetchReturning(body)

  const result = await fetchSponsorQr({ fetchImpl, keyBase64: TEST_KEY_BASE64 })

  assert.deepEqual(result, {
    ok: true,
    dataUrl: `data:image/jpeg;base64,${JPEG_BYTES.toString('base64')}`,
    sha256: encrypted.sha256
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0], `${SERVER_ORIGIN}${SPONSOR_QR_ENDPOINT_PATH}`)
  assert.equal(calls[0], 'https://jianchihu.online/api/assets/sponsor-qr')
})

test('detects png magic bytes and reports the png mime in the data url', async () => {
  const body = { scheme: 'aes-256-gcm', ...encryptForTest(PNG_BYTES) }
  const { fetchImpl } = fetchReturning(body)

  const result = await fetchSponsorQr({ fetchImpl, keyBase64: TEST_KEY_BASE64 })

  assert.equal(result.ok, true)
  assert.ok(result.dataUrl.startsWith('data:image/png;base64,'))
  assert.deepEqual(Buffer.from(result.dataUrl.slice('data:image/png;base64,'.length), 'base64'), PNG_BYTES)
})

test('fails closed when the ciphertext fails gcm authentication', async () => {
  const body = { scheme: 'aes-256-gcm', ...encryptForTest(JPEG_BYTES) }
  const encrypted = Buffer.from(body.payload, 'base64')
  encrypted[0] ^= 0xff
  body.payload = encrypted.toString('base64')
  const { fetchImpl } = fetchReturning(body)

  const result = await fetchSponsorQr({ fetchImpl, keyBase64: TEST_KEY_BASE64 })

  assert.deepEqual(result, { ok: false, error: 'decrypt-failed' })
})

test('fails when the plaintext sha256 does not match the announced digest', async () => {
  const body = { scheme: 'aes-256-gcm', ...encryptForTest(JPEG_BYTES), sha256: 'a'.repeat(64) }
  const { fetchImpl } = fetchReturning(body)

  const result = await fetchSponsorQr({ fetchImpl, keyBase64: TEST_KEY_BASE64 })

  assert.deepEqual(result, { ok: false, error: 'sha256-mismatch' })
})

test('rejects an unsupported encryption scheme', async () => {
  const body = { scheme: 'aes-128-gcm', ...encryptForTest(JPEG_BYTES) }
  const { fetchImpl } = fetchReturning(body)

  const result = await fetchSponsorQr({ fetchImpl, keyBase64: TEST_KEY_BASE64 })

  assert.deepEqual(result, { ok: false, error: 'bad-scheme' })
})

test('rejects missing or malformed fields without touching decryption', async () => {
  const encrypted = encryptForTest(JPEG_BYTES)
  const base = { scheme: 'aes-256-gcm', ...encrypted }

  const cases = [
    { ...base, nonce: undefined },
    { ...base, payload: undefined },
    { ...base, sha256: undefined },
    { ...base, nonce: 'short' },
    { ...base, payload: '####' },
    { ...base, sha256: encrypted.sha256.toUpperCase() },
    { ...base, sha256: encrypted.sha256.slice(0, 63) }
  ]

  for (const body of cases) {
    const { fetchImpl } = fetchReturning(body)
    const result = await fetchSponsorQr({ fetchImpl, keyBase64: TEST_KEY_BASE64 })
    assert.equal(result.ok, false, `expected failure for body ${JSON.stringify(body)}`)
  }
})

test('fails on non-200 responses', async () => {
  const body = { scheme: 'aes-256-gcm', ...encryptForTest(JPEG_BYTES) }
  const { fetchImpl } = fetchReturning(body, 500)

  const result = await fetchSponsorQr({ fetchImpl, keyBase64: TEST_KEY_BASE64 })

  assert.equal(result.ok, false)
  assert.equal(result.error, 'http-500')
})

test('fails on network errors without throwing', async () => {
  const result = await fetchSponsorQr({
    fetchImpl: async () => { throw new Error('ECONNRESET') },
    keyBase64: TEST_KEY_BASE64
  })

  assert.deepEqual(result, { ok: false, error: 'network-error' })
})

test('fails when the response body is not usable JSON', async () => {
  const fetchImpl = async () => ({
    status: 200,
    json: async () => { throw new Error('invalid json') }
  })

  const result = await fetchSponsorQr({ fetchImpl, keyBase64: TEST_KEY_BASE64 })

  assert.deepEqual(result, { ok: false, error: 'bad-json' })
})

test('fails with a wrong decryption key', async () => {
  const body = { scheme: 'aes-256-gcm', ...encryptForTest(JPEG_BYTES) }
  const { fetchImpl } = fetchReturning(body)

  const result = await fetchSponsorQr({
    fetchImpl,
    keyBase64: crypto.randomBytes(32).toString('base64')
  })

  assert.deepEqual(result, { ok: false, error: 'decrypt-failed' })
})
