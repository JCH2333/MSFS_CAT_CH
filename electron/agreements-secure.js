const crypto = require('node:crypto')
const { buildServerUrl } = require('./distribution-server')

// 协议正文安全加载（密文打包 + 运行时向服务器取钥解密）。
//
// 客户端不再内置协议明文：构建时由 tools/encrypt-agreements.mjs 把全文加密成
// electron/resources/agreements-enc.json（随安装包分发，不含密钥），解密密钥只
// 保存在分发服务器 application.yml 的 app.legal.text-keys。
//
// 主进程职责：打开协议弹窗时联网 GET /api/legal/text-key/<revision> 取钥 →
// 本地解密 → 按存证口径校验 SHA-256 → 只把明文经 IPC 交给渲染层弹窗。
// 明文仅保留在内存缓存，绝不落盘；任何失败返回 { ok:false, error }，绝不抛异常，
// 失败路径不留下任何明文缓存（用户需联网后重试，离线无法同意协议是已接受的取舍）。

const TEXT_KEY_ENDPOINT_BASE = '/api/legal/text-key'
const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const NONCE_BYTES = 12
const AUTH_TAG_BYTES = 16
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const REVISION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

// 协议全文的 pinned SHA-256（legal-evidence 存证口径：两份全文按 user→notice
// 顺序单换行拼接后 UTF-8 SHA-256）。协议换版时必须与 tools/agreements-texts.mjs、
// tools/encrypt-agreements.mjs 同步更换，三方一致由 tests/agreements-secure.test.js 守护。
// 该 pinned 值仅约束随安装包分发的内置密文包；服务器推送的更新修订版由作者
// ed25519 签名约束（见 AGREEMENT_SIGNING_PUBLIC_KEY 与 verifyBundleSignature）。
const AGREEMENT_TEXT_SHA256 = '9581c89ddfd19a7c5331042bb071003514f0c66910f83c9ba2bc6b8c944ff650'

// 作者协议签名公钥（ed25519，SPKI PEM）。私钥只存开发机 .local-keys/（不入库），
// 构建工具 tools/encrypt-agreements.mjs 用私钥对每个修订版签名，客户端用本公钥验证。
// 有了这把公钥，今后协议换版只更新服务器归档与密文包，客户端无需发版即可强制重新同意；
// 传输通道即使是 HTTP，伪造的协议正文也无法通过验签。
const AGREEMENT_SIGNING_PUBLIC_KEY = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEA3JDAMPd3OjC70fpuVp+Nb3cWSjwX0YMxGoBenOJ7os0=',
  '-----END PUBLIC KEY-----',
  ''
].join('\n')

// 解密明文的 JSON 结构约定：[{id:'user',body},{id:'notice',body}]，顺序与存证口径一致
const AGREEMENT_IDS = ['user', 'notice']

// 内嵌密文包（构建产物；缺失或损坏时 getAgreementText 返回 bad-bundle）
function loadEmbeddedBundle() {
  try {
    return require('./resources/agreements-enc.json')
  } catch {
    return null
  }
}

// 只接受标准 base64（含 padding），避免宽松解码放过畸形输入
function decodeBase64Field(value) {
  if (typeof value !== 'string' || value === '' || value.length % 4 !== 0) return null
  if (!BASE64_PATTERN.test(value)) return null
  return Buffer.from(value, 'base64')
}

// 校验密文包结构；返回规范化后的字段，结构非法返回 null。
function validateEncryptedBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return null
  if (typeof bundle.revision !== 'string' || !REVISION_PATTERN.test(bundle.revision)) return null
  if (bundle.algorithm !== ALGORITHM) return null
  const nonce = decodeBase64Field(bundle.nonce)
  if (!nonce || nonce.length !== NONCE_BYTES) return null
  const payload = decodeBase64Field(bundle.payload)
  if (!payload || payload.length <= AUTH_TAG_BYTES) return null
  if (typeof bundle.sha256 !== 'string' || !SHA256_HEX_PATTERN.test(bundle.sha256)) return null
  return { revision: bundle.revision, nonce, payload, sha256: bundle.sha256 }
}

// 与 legal-evidence.computeAgreementHash 相同的存证拼接口径
function joinAgreementHash(bodies) {
  return crypto.createHash('sha256').update(bodies.join('\n'), 'utf8').digest('hex')
}

// 解密并解析明文；任何一步失败都返回 { ok:false, error }，不抛异常。
// expectedTextSha256 默认为 pinned 常量，测试可注入自有密文包对应的期望值。
function decryptBundle(bundle, key, expectedTextSha256 = AGREEMENT_TEXT_SHA256) {
  const authTag = bundle.payload.subarray(bundle.payload.length - AUTH_TAG_BYTES)
  const ciphertext = bundle.payload.subarray(0, bundle.payload.length - AUTH_TAG_BYTES)
  let plaintext
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, bundle.nonce)
    decipher.setAuthTag(authTag)
    // GCM 认证失败时 final() 抛错，绝不输出明文
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    return { ok: false, error: 'decrypt-failed' }
  }

  let entries
  try {
    entries = JSON.parse(plaintext.toString('utf8'))
  } catch {
    return { ok: false, error: 'bad-plaintext' }
  }
  if (!Array.isArray(entries) || entries.length !== AGREEMENT_IDS.length) {
    return { ok: false, error: 'bad-plaintext' }
  }
  const agreements = []
  const bodies = []
  for (let index = 0; index < AGREEMENT_IDS.length; index += 1) {
    const entry = entries[index]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, error: 'bad-plaintext' }
    if (entry.id !== AGREEMENT_IDS[index]) return { ok: false, error: 'bad-plaintext' }
    if (typeof entry.body !== 'string' || entry.body.trim() === '') return { ok: false, error: 'bad-plaintext' }
    agreements.push({ id: entry.id, body: entry.body })
    bodies.push(entry.body)
  }

  // pinned 口径校验：解密出的全文哈希必须同时等于密文包声明的哈希与期望的 pinned 值
  const digest = joinAgreementHash(bodies)
  if (digest !== bundle.sha256 || digest !== expectedTextSha256) {
    return { ok: false, error: 'sha256-mismatch' }
  }
  return { ok: true, agreements }
}

// 内存缓存（明文）：仅在同一次运行内复用；失败与换版都不会误用旧缓存
let cachedAgreements = null
let inFlightLoad = null

async function loadAgreementText({ fetchImpl = globalThis.fetch, bundle = loadEmbeddedBundle(), expectedTextSha256 = AGREEMENT_TEXT_SHA256 } = {}) {
  try {
    if (typeof fetchImpl !== 'function') return { ok: false, error: 'fetch-unavailable' }
    const parsedBundle = validateEncryptedBundle(bundle)
    if (!parsedBundle) return { ok: false, error: 'bad-bundle' }
    // 密文包声明的哈希必须等于 pinned 常量：防止包被整体替换成其它内容的密文
    if (parsedBundle.sha256 !== expectedTextSha256) return { ok: false, error: 'sha256-pin-mismatch' }

    if (cachedAgreements
      && cachedAgreements.revision === parsedBundle.revision
      && cachedAgreements.sha256 === parsedBundle.sha256) {
      return { ok: true, revision: parsedBundle.revision, agreements: cachedAgreements.agreements }
    }

    let response
    try {
      response = await fetchImpl(buildServerUrl(`${TEXT_KEY_ENDPOINT_BASE}/${encodeURIComponent(parsedBundle.revision)}`))
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
    if (!body || typeof body !== 'object' || body.code !== 200) return { ok: false, error: 'bad-code' }
    const key = decodeBase64Field(body?.data?.key)
    if (!key || key.length !== KEY_BYTES) return { ok: false, error: 'bad-key' }

    const decrypted = decryptBundle(parsedBundle, key, expectedTextSha256)
    if (!decrypted.ok) return decrypted

    // 全部校验通过才写内存缓存；失败路径绝不停留明文
    cachedAgreements = { revision: parsedBundle.revision, sha256: parsedBundle.sha256, agreements: decrypted.agreements }
    return { ok: true, revision: parsedBundle.revision, agreements: decrypted.agreements }
  } catch {
    return { ok: false, error: 'unexpected-error' }
  }
}

/**
 * 获取协议全文（主进程内使用，IPC legal:get-agreement-text 暴露给渲染层）。
 * 并发调用合并为同一次取钥/解密；除 options 注入外全部走真实内嵌密文与服务器。
 * 返回 { ok:true, revision, agreements:[{id,body}] } 或 { ok:false, error }。
 */
function getAgreementText(options = {}) {
  if (inFlightLoad) return inFlightLoad
  const request = loadAgreementText(options).finally(() => { inFlightLoad = null })
  inFlightLoad = request
  return request
}

// 测试专用：清空内存明文缓存
function clearAgreementTextCache() {
  cachedAgreements = null
}

// ---------- 服务器推送的更新修订版（2.1.1 起） ----------
//
// 设计：内置密文包只覆盖安装时刻的修订版；此后协议换版只更新服务器
// （GET /api/legal/latest-revision 声明最新修订版与全文哈希，GET /api/legal/bundle/<revision>
// 下发签名密文包，密钥仍走 /api/legal/text-key/<revision>）。客户端启动后比对
// 已同意修订版与服务器最新修订版，不一致时拉取新正文并强制重新同意。
// 信任锚是 AGREEMENT_SIGNING_PUBLIC_KEY：签名覆盖 revision 与全文 SHA-256，
// HTTP 传输被劫持也无法伪造协议正文；验签失败一律拒绝，绝不展示未签名正文。

const LATEST_REVISION_ENDPOINT_PATH = '/api/legal/latest-revision'
const BUNDLE_ENDPOINT_PATH = '/api/legal/bundle'
const SIGNATURE_ALGORITHM = 'ed25519'
const SIGNATURE_MESSAGE_PREFIX = 'legal-agreement-v1'

// 验证服务器密文包的作者签名；结构非法、缺签名或验签失败一律 false。
function verifyBundleSignature(bundle, publicKey = AGREEMENT_SIGNING_PUBLIC_KEY) {
  try {
    if (!bundle || typeof bundle !== 'object') return false
    if (typeof bundle.revision !== 'string' || !REVISION_PATTERN.test(bundle.revision)) return false
    if (typeof bundle.sha256 !== 'string' || !SHA256_HEX_PATTERN.test(bundle.sha256)) return false
    if (bundle.signatureAlgorithm !== SIGNATURE_ALGORITHM) return false
    const signature = decodeBase64Field(bundle.signature)
    if (!signature) return false
    const message = Buffer.from(`${SIGNATURE_MESSAGE_PREFIX}:${bundle.revision}:${bundle.sha256}`, 'utf8')
    return crypto.verify(null, message, publicKey, signature)
  } catch {
    return false
  }
}

// 服务器密文包 = 内置包同样的结构校验 + 必须通过作者签名验证。
// signingPublicKey 仅供测试注入；生产路径一律使用内嵌公钥。
function validateSignedBundle(bundle, signingPublicKey = AGREEMENT_SIGNING_PUBLIC_KEY) {
  const parsed = validateEncryptedBundle(bundle)
  if (!parsed || !verifyBundleSignature(bundle, signingPublicKey)) return null
  return parsed
}

async function fetchServerJson(fetchImpl, path) {
  let response
  try {
    response = await fetchImpl(buildServerUrl(path))
  } catch {
    return { error: 'network-error' }
  }
  if (!response || response.status !== 200) return { error: `http-${response?.status ?? 'unknown'}` }
  try {
    return { body: await response.json() }
  } catch {
    return { error: 'bad-json' }
  }
}

// 拉取并校验指定修订版的远程正文：签名 → 密钥 → 解密 → 三方哈希一致。
async function loadRemoteAgreementText({ revision, expectedSha256, signingPublicKey, fetchImpl = globalThis.fetch } = {}) {
  try {
    if (typeof fetchImpl !== 'function') return { ok: false, error: 'fetch-unavailable' }
    if (typeof revision !== 'string' || !REVISION_PATTERN.test(revision)) return { ok: false, error: 'bad-revision' }
    if (typeof expectedSha256 !== 'string' || !SHA256_HEX_PATTERN.test(expectedSha256)) return { ok: false, error: 'bad-expected-hash' }

    const bundleResult = await fetchServerJson(fetchImpl, `${BUNDLE_ENDPOINT_PATH}/${encodeURIComponent(revision)}`)
    if (bundleResult.error) return { ok: false, error: bundleResult.error }
    const parsed = validateSignedBundle(bundleResult.body, signingPublicKey)
    if (!parsed) return { ok: false, error: 'bad-bundle' }
    if (parsed.revision !== revision || parsed.sha256 !== expectedSha256) return { ok: false, error: 'revision-mismatch' }

    const keyResult = await fetchServerJson(fetchImpl, `${TEXT_KEY_ENDPOINT_BASE}/${encodeURIComponent(revision)}`)
    if (keyResult.error) return { ok: false, error: keyResult.error }
    const keyBody = keyResult.body
    if (!keyBody || typeof keyBody !== 'object' || keyBody.code !== 200) return { ok: false, error: 'bad-code' }
    const key = decodeBase64Field(keyBody?.data?.key)
    if (!key || key.length !== KEY_BYTES) return { ok: false, error: 'bad-key' }

    const decrypted = decryptBundle(parsed, key, expectedSha256)
    if (!decrypted.ok) return decrypted
    return { ok: true, revision, agreements: decrypted.agreements, textSha256: expectedSha256 }
  } catch {
    return { ok: false, error: 'unexpected-error' }
  }
}

/**
 * 比对已同意修订版与服务器最新修订版；不一致时拉取新正文。
 * 返回 { ok:true, upToDate:true, revision } 或
 * { ok:true, upToDate:false, revision, agreements, textSha256 } 或 { ok:false, error }。
 * 网络失败一律 ok:false，由调用方保持现状继续可用（离线不阻塞）。
 */
async function checkAgreementUpdate({ acceptedRevision, signingPublicKey, fetchImpl = globalThis.fetch } = {}) {
  try {
    if (typeof fetchImpl !== 'function') return { ok: false, error: 'fetch-unavailable' }
    if (acceptedRevision != null && (typeof acceptedRevision !== 'string' || !REVISION_PATTERN.test(acceptedRevision))) {
      return { ok: false, error: 'bad-accepted-revision' }
    }
    const latest = await fetchServerJson(fetchImpl, LATEST_REVISION_ENDPOINT_PATH)
    if (latest.error) return { ok: false, error: latest.error }
    const body = latest.body
    if (!body || typeof body !== 'object' || body.code !== 200) return { ok: false, error: 'bad-code' }
    const revision = body?.data?.revision
    const agreementSha256 = body?.data?.agreementSha256
    if (typeof revision !== 'string' || !REVISION_PATTERN.test(revision)) return { ok: false, error: 'bad-revision' }
    if (acceptedRevision === revision) return { ok: true, upToDate: true, revision }
    const text = await loadRemoteAgreementText({ revision, expectedSha256: agreementSha256, signingPublicKey, fetchImpl })
    if (!text.ok) return { ok: false, error: text.error }
    return { ok: true, upToDate: false, revision, agreements: text.agreements, textSha256: text.textSha256 }
  } catch {
    return { ok: false, error: 'unexpected-error' }
  }
}

module.exports = {
  AGREEMENT_IDS,
  AGREEMENT_SIGNING_PUBLIC_KEY,
  AGREEMENT_TEXT_SHA256,
  ALGORITHM,
  AUTH_TAG_BYTES,
  KEY_BYTES,
  LATEST_REVISION_ENDPOINT_PATH,
  NONCE_BYTES,
  SIGNATURE_ALGORITHM,
  SIGNATURE_MESSAGE_PREFIX,
  TEXT_KEY_ENDPOINT_BASE,
  checkAgreementUpdate,
  clearAgreementTextCache,
  decodeBase64Field,
  getAgreementText,
  joinAgreementHash,
  loadEmbeddedBundle,
  validateEncryptedBundle,
  verifyBundleSignature
}
