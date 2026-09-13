const crypto = require('node:crypto')
const { buildServerUrl } = require('./distribution-server')

const SPONSOR_QR_ENDPOINT_PATH = '/api/assets/sponsor-qr'
const QR_NONCE_BYTES = 12
const QR_AUTH_TAG_BYTES = 16
const QR_KEY_BYTES = 32
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

// 与服务端 app.assets.qr-key 一致，泄露仅影响混淆强度，完整性由 SHA-256 校验保证。
const K_A = 'LbdM6Tr9bmn2UeoSjR3hwZICig04+sNu'
const K_B = '1tV1Gh4AkhA='
const KEY_B64 = K_A + K_B

// 只接受标准 base64（含 padding），避免宽松解码放过畸形输入。
function decodeBase64Field(value) {
  if (typeof value !== 'string' || value === '' || value.length % 4 !== 0) return null
  if (!BASE64_PATTERN.test(value)) return null
  return Buffer.from(value, 'base64')
}

// 仅凭明文字节判断图片格式，不信任服务器返回的任何 mime 描述。
function detectImageMime(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  return null
}

async function fetchSponsorQr({ fetchImpl = globalThis.fetch, keyBase64 = KEY_B64 } = {}) {
  try {
    if (typeof fetchImpl !== 'function') return { ok: false, error: 'fetch-unavailable' }
    const key = Buffer.from(keyBase64, 'base64')
    if (key.length !== QR_KEY_BYTES) return { ok: false, error: 'bad-key' }

    let response
    try {
      response = await fetchImpl(buildServerUrl(SPONSOR_QR_ENDPOINT_PATH))
    } catch {
      return { ok: false, error: 'network-error' }
    }
    if (!response || response.status !== 200) {
      return { ok: false, error: `http-${response?.status ?? 'unknown'}` }
    }

    let body
    try {
      body = await response.json()
    } catch {
      return { ok: false, error: 'bad-json' }
    }
    if (!body || typeof body !== 'object') return { ok: false, error: 'bad-body' }
    if (body.scheme !== 'aes-256-gcm') return { ok: false, error: 'bad-scheme' }

    const nonce = decodeBase64Field(body.nonce)
    if (!nonce || nonce.length !== QR_NONCE_BYTES) return { ok: false, error: 'bad-nonce' }

    const encrypted = decodeBase64Field(body.payload)
    if (!encrypted || encrypted.length <= QR_AUTH_TAG_BYTES) return { ok: false, error: 'bad-payload' }

    if (typeof body.sha256 !== 'string' || !SHA256_HEX_PATTERN.test(body.sha256)) {
      return { ok: false, error: 'bad-sha256' }
    }

    // auth tag 128 bit 拼在密文尾部，GCM 认证失败时必须整体失败，绝不输出明文。
    const authTag = encrypted.subarray(encrypted.length - QR_AUTH_TAG_BYTES)
    const ciphertext = encrypted.subarray(0, encrypted.length - QR_AUTH_TAG_BYTES)
    let plaintext
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce)
      decipher.setAuthTag(authTag)
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch {
      return { ok: false, error: 'decrypt-failed' }
    }

    const digest = crypto.createHash('sha256').update(plaintext).digest('hex')
    if (digest !== body.sha256) return { ok: false, error: 'sha256-mismatch' }

    const mime = detectImageMime(plaintext)
    if (!mime) return { ok: false, error: 'unsupported-image' }

    return {
      ok: true,
      dataUrl: `data:${mime};base64,${plaintext.toString('base64')}`,
      sha256: digest
    }
  } catch {
    return { ok: false, error: 'unexpected-error' }
  }
}

module.exports = {
  SPONSOR_QR_ENDPOINT_PATH,
  detectImageMime,
  fetchSponsorQr
}
