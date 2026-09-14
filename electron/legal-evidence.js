const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { buildServerUrl } = require('./distribution-server')

// 协议同意存证（法律证据留存）。
// 主进程职责：生成并持久化匿名设备标识、对两份协议全文做 SHA-256、匿名上报同意记录。
// 只上报协议修订号、文本哈希、随机设备标识与时间，不上传任何协议文本内容或使用行为。
// 网络失败一律返回 { ok:false }，由渲染层把记录暂存到 localStorage 等待下次启动补报。

const LEGAL_ACCEPTANCES_ENDPOINT_PATH = '/api/legal/acceptances'
const DEVICE_ID_FILE_NAME = 'legal-device-id.json'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 与服务器归档 manifest 的 agreementSha256 同口径：
// 两份协议全文按 [用户协议, 免责声明] 顺序以单个换行拼接后取 UTF-8 SHA-256。
function computeAgreementHash(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return null
  for (const text of texts) {
    if (typeof text !== 'string' || text.trim() === '') return null
  }
  return crypto.createHash('sha256').update(texts.join('\n'), 'utf8').digest('hex')
}

function isValidDeviceId(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

// 匿名设备标识：在 userData 下持久化为 legal-device-id.json（比 localStorage 更稳，
// 清空浏览器数据不影响）。文件缺失或损坏时重新生成。
async function ensureDeviceIdOnce(userDataDirectory, {
  randomUUIDImpl,
  readFileImpl = fsp.readFile,
  writeFileImpl = fsp.writeFile,
  mkdirImpl = fsp.mkdir
} = {}) {
  if (typeof userDataDirectory !== 'string' || userDataDirectory.trim() === '') {
    throw new Error('缺少用户数据目录，无法维护匿名设备标识')
  }
  const file = path.join(userDataDirectory, DEVICE_ID_FILE_NAME)
  try {
    const raw = await readFileImpl(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (isValidDeviceId(parsed?.deviceId)) return parsed.deviceId
  } catch {
    // 文件不存在或内容损坏时重新生成
  }
  const deviceId = typeof randomUUIDImpl === 'function' ? randomUUIDImpl() : crypto.randomUUID()
  if (!isValidDeviceId(deviceId)) throw new Error('生成的匿名设备标识无效')
  await mkdirImpl(userDataDirectory, { recursive: true })
  await writeFileImpl(file, `${JSON.stringify({ deviceId }, null, 2)}\n`, 'utf8')
  return deviceId
}

// 并发调用合并为同一次读写，避免同时生成多个设备标识。
const inFlightEnsures = new Map()

function ensureDeviceId(userDataDirectory, options = {}) {
  const key = path.resolve(userDataDirectory)
  if (inFlightEnsures.has(key)) return inFlightEnsures.get(key)
  const promise = ensureDeviceIdOnce(userDataDirectory, options).finally(() => inFlightEnsures.delete(key))
  inFlightEnsures.set(key, promise)
  return promise
}

function normalizeOptionalTime(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

// 组装服务端请求体；只包含白名单字段。
function buildRequestPayload(payload, deviceId) {
  return {
    agreementRevision: typeof payload?.revision === 'string' ? payload.revision.trim() : '',
    agreementSha256: typeof payload?.textSha256 === 'string' ? payload.textSha256.trim().toLowerCase() : '',
    deviceId,
    acceptedAt: normalizeOptionalTime(payload?.acceptedAt),
    clientRecordedAt: normalizeOptionalTime(payload?.clientRecordedAt),
    appVersion: typeof payload?.appVersion === 'string' ? payload.appVersion.trim().slice(0, 32) : '',
    platform: typeof payload?.platform === 'string' ? payload.platform.trim().slice(0, 32) : ''
  }
}

/**
 * 上报一条协议同意存证。任何失败都不抛异常，返回 { ok:false, reason }。
 * payload 来自渲染层：{ revision, userAgreement, disclaimer, acceptedAt, clientRecordedAt }；
 * 哈希统一在主进程按归档口径计算，渲染层只传全文与修订号。
 */
async function reportAgreementAcceptance(payload, { fetchImpl = globalThis.fetch, userDataDirectory, appVersion = '' } = {}) {
  try {
    const revision = typeof payload?.revision === 'string' ? payload.revision.trim() : ''
    const textSha256 = computeAgreementHash([payload?.userAgreement, payload?.disclaimer])
    if (!revision || !textSha256) return { ok: false, reason: 'invalid-payload' }
    if (typeof fetchImpl !== 'function') return { ok: false, reason: 'no-network' }
    if (typeof userDataDirectory !== 'string' || userDataDirectory.trim() === '') {
      return { ok: false, reason: 'no-user-data' }
    }

    const deviceId = await ensureDeviceId(userDataDirectory)
    const body = buildRequestPayload({ ...payload, revision, textSha256, appVersion, platform: process.platform }, deviceId)

    let response
    try {
      response = await fetchImpl(buildServerUrl(LEGAL_ACCEPTANCES_ENDPOINT_PATH), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    } catch {
      return { ok: false, reason: 'network' }
    }

    if (response.ok) {
      let recordedAt = null
      try {
        const result = await response.json()
        recordedAt = typeof result?.data?.recordedAt === 'string' ? result.data.recordedAt : null
      } catch {
        // 服务端返回非 JSON 时仍视为成功，只是拿不到服务端时间
      }
      return { ok: true, recordedAt }
    }
    return { ok: false, reason: response.status === 429 ? 'rate-limited' : `http-${response.status}` }
  } catch {
    return { ok: false, reason: 'unexpected' }
  }
}

module.exports = {
  DEVICE_ID_FILE_NAME,
  LEGAL_ACCEPTANCES_ENDPOINT_PATH,
  buildRequestPayload,
  computeAgreementHash,
  ensureDeviceId,
  isValidDeviceId,
  reportAgreementAcceptance
}
