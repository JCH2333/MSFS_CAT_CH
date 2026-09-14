const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  DEVICE_ID_FILE_NAME,
  LEGAL_ACCEPTANCES_ENDPOINT_PATH,
  buildRequestPayload,
  computeAgreementHash,
  ensureDeviceId,
  isValidDeviceId,
  reportAgreementAcceptance
} = require('../electron/legal-evidence')
const { SERVER_ORIGIN } = require('../electron/distribution-server')

const USER_AGREEMENT_TEXT = '用户使用协议全文\n第二行'
const DISCLAIMER_TEXT = '免责声明全文'
const FIXED_UUID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body }
}

test('computes the agreement hash by joining both texts with a newline', () => {
  assert.equal(computeAgreementHash([USER_AGREEMENT_TEXT, DISCLAIMER_TEXT]), sha256(`${USER_AGREEMENT_TEXT}\n${DISCLAIMER_TEXT}`))
})

test('agreement hash is order sensitive and lowercase hex', () => {
  const forward = computeAgreementHash([USER_AGREEMENT_TEXT, DISCLAIMER_TEXT])
  const backward = computeAgreementHash([DISCLAIMER_TEXT, USER_AGREEMENT_TEXT])
  assert.notEqual(forward, backward)
  assert.match(forward, /^[0-9a-f]{64}$/)
})

test('agreement hash rejects missing or empty texts', () => {
  assert.equal(computeAgreementHash(null), null)
  assert.equal(computeAgreementHash([]), null)
  assert.equal(computeAgreementHash(['只有一份', undefined]), null)
  assert.equal(computeAgreementHash([USER_AGREEMENT_TEXT, '   ']), null)
})

test('validates anonymous device ids as uuid', () => {
  assert.equal(isValidDeviceId(FIXED_UUID), true)
  assert.equal(isValidDeviceId(FIXED_UUID.toUpperCase()), true)
  assert.equal(isValidDeviceId('not-a-uuid'), false)
  assert.equal(isValidDeviceId('0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f'), false)
  assert.equal(isValidDeviceId(42), false)
  assert.equal(isValidDeviceId(null), false)
})

test('ensureDeviceId persists a stable anonymous id in the user data directory', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'legal-evidence-'))
  const first = await ensureDeviceId(directory)
  assert.equal(isValidDeviceId(first), true)

  const stored = JSON.parse(await fs.readFile(path.join(directory, DEVICE_ID_FILE_NAME), 'utf8'))
  assert.equal(stored.deviceId, first)
  assert.equal(await ensureDeviceId(directory), first, '重复调用必须复用已持久化的设备标识')

  await fs.rm(directory, { recursive: true, force: true })
})

test('ensureDeviceId regenerates when the stored file is corrupt', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'legal-evidence-'))
  await fs.writeFile(path.join(directory, DEVICE_ID_FILE_NAME), '{broken json', 'utf8')
  const regenerated = await ensureDeviceId(directory)
  assert.equal(isValidDeviceId(regenerated), true)
  assert.notEqual(regenerated, 'undefined')

  await fs.rm(directory, { recursive: true, force: true })
})

test('ensureDeviceId rejects an empty user data directory', async () => {
  await assert.rejects(() => ensureDeviceId('   '), /用户数据目录/)
})

test('ensureDeviceId keeps the stored id even if it was written by another uuid source', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'legal-evidence-'))
  await fs.writeFile(path.join(directory, DEVICE_ID_FILE_NAME), JSON.stringify({ deviceId: FIXED_UUID }), 'utf8')
  assert.equal(await ensureDeviceId(directory), FIXED_UUID)

  await fs.rm(directory, { recursive: true, force: true })
})

test('buildRequestPayload whitelists evidence fields only', () => {
  const payload = buildRequestPayload({
    revision: ' 2026-09-15-v1 ',
    textSha256: sha256('x').toUpperCase(),
    acceptedAt: '2026-09-15T08:00:00.000Z',
    clientRecordedAt: '2026-09-15T08:00:01.000Z',
    appVersion: '2.0.0',
    platform: 'win32',
    userAgreement: '协议全文不应进入请求体',
    secret: 'should-drop'
  }, FIXED_UUID)

  assert.deepEqual(payload, {
    agreementRevision: '2026-09-15-v1',
    agreementSha256: sha256('x'),
    deviceId: FIXED_UUID,
    acceptedAt: '2026-09-15T08:00:00.000Z',
    clientRecordedAt: '2026-09-15T08:00:01.000Z',
    appVersion: '2.0.0',
    platform: 'win32'
  })
})

test('reportAgreementAcceptance posts the hashed evidence to the legal endpoint', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'legal-evidence-'))
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return okResponse({ code: 200, message: 'success', data: { recordedAt: '2026-09-15 16:00:00' } })
  }

  const result = await reportAgreementAcceptance(
    {
      revision: '2026-09-15-v1',
      userAgreement: USER_AGREEMENT_TEXT,
      disclaimer: DISCLAIMER_TEXT,
      acceptedAt: '2026-09-15T08:00:00.000Z',
      clientRecordedAt: '2026-09-15T08:00:00.000Z'
    },
    { fetchImpl, userDataDirectory: directory, appVersion: '2.0.0' }
  )

  assert.equal(result.ok, true)
  assert.equal(result.recordedAt, '2026-09-15 16:00:00')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${SERVER_ORIGIN}${LEGAL_ACCEPTANCES_ENDPOINT_PATH}`)
  assert.equal(calls[0].options.method, 'POST')

  const body = JSON.parse(calls[0].options.body)
  assert.equal(body.agreementRevision, '2026-09-15-v1')
  assert.equal(body.agreementSha256, computeAgreementHash([USER_AGREEMENT_TEXT, DISCLAIMER_TEXT]))
  assert.equal(isValidDeviceId(body.deviceId), true)
  assert.equal(body.appVersion, '2.0.0')
  assert.equal(typeof body.platform, 'string')
  assert.equal(body.userAgreement, undefined, '协议全文绝不能离开本机')

  await fs.rm(directory, { recursive: true, force: true })
})

test('reportAgreementAcceptance never throws on network failures', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'legal-evidence-'))
  const networkFailure = await reportAgreementAcceptance(
    { revision: '2026-09-15-v1', userAgreement: USER_AGREEMENT_TEXT, disclaimer: DISCLAIMER_TEXT },
    { fetchImpl: async () => { throw new Error('offline') }, userDataDirectory: directory }
  )
  assert.deepEqual(networkFailure.ok, false)
  assert.equal(networkFailure.reason, 'network')

  // null 不会触发默认的 globalThis.fetch，确定性地命中"当前环境无法上报"分支
  const throwingFetch = await reportAgreementAcceptance(
    { revision: '2026-09-15-v1', userAgreement: USER_AGREEMENT_TEXT, disclaimer: DISCLAIMER_TEXT },
    { fetchImpl: null, userDataDirectory: directory }
  )
  assert.equal(throwingFetch.ok, false)

  await fs.rm(directory, { recursive: true, force: true })
})

test('reportAgreementAcceptance rejects invalid payloads before any network call', async () => {
  let called = 0
  const fetchImpl = async () => {
    called += 1
    return okResponse({ code: 200, data: {} })
  }
  const missingDisclaimer = await reportAgreementAcceptance(
    { revision: '2026-09-15-v1', userAgreement: USER_AGREEMENT_TEXT },
    { fetchImpl, userDataDirectory: os.tmpdir() }
  )
  const missingRevision = await reportAgreementAcceptance(
    { userAgreement: USER_AGREEMENT_TEXT, disclaimer: DISCLAIMER_TEXT },
    { fetchImpl, userDataDirectory: os.tmpdir() }
  )
  assert.equal(missingDisclaimer.ok, false)
  assert.equal(missingRevision.ok, false)
  assert.equal(called, 0, '无效载荷不得发起网络请求')
})

test('reportAgreementAcceptance maps server rejection statuses to failure reasons', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'legal-evidence-'))
  const rateLimited = await reportAgreementAcceptance(
    { revision: '2026-09-15-v1', userAgreement: USER_AGREEMENT_TEXT, disclaimer: DISCLAIMER_TEXT },
    { fetchImpl: async () => ({ ok: false, status: 429 }), userDataDirectory: directory }
  )
  const serverError = await reportAgreementAcceptance(
    { revision: '2026-09-15-v1', userAgreement: USER_AGREEMENT_TEXT, disclaimer: DISCLAIMER_TEXT },
    { fetchImpl: async () => ({ ok: false, status: 500 }), userDataDirectory: directory }
  )
  assert.deepEqual(rateLimited, { ok: false, reason: 'rate-limited' })
  assert.deepEqual(serverError, { ok: false, reason: 'http-500' })

  await fs.rm(directory, { recursive: true, force: true })
})

test('renderer pending record round-trips and rejects damaged data', async () => {
  const { createPendingRecord, parsePendingRecord, pendingRecordToReportPayload, serializePendingRecord } = await import('../src/lib/legal-evidence.mjs')

  const record = createPendingRecord(
    { revision: '2026-09-15-v1', userAgreement: USER_AGREEMENT_TEXT, disclaimer: DISCLAIMER_TEXT },
    new Date('2026-09-15T08:00:00.000Z')
  )
  assert.equal(record.acceptedAt, '2026-09-15T08:00:00.000Z')
  assert.equal(record.clientRecordedAt, record.acceptedAt)

  const restored = parsePendingRecord(serializePendingRecord(record))
  assert.deepEqual(restored, record)
  assert.deepEqual(pendingRecordToReportPayload(restored), {
    revision: '2026-09-15-v1',
    userAgreement: USER_AGREEMENT_TEXT,
    disclaimer: DISCLAIMER_TEXT,
    acceptedAt: '2026-09-15T08:00:00.000Z',
    clientRecordedAt: '2026-09-15T08:00:00.000Z'
  })

  assert.equal(parsePendingRecord(null), null)
  assert.equal(parsePendingRecord(''), null)
  assert.equal(parsePendingRecord('not json'), null)
  assert.equal(parsePendingRecord('[]'), null)
  assert.equal(parsePendingRecord(JSON.stringify({ revision: '', userAgreement: 'a', disclaimer: 'b' })), null)
  assert.equal(parsePendingRecord(JSON.stringify({ revision: 'r', disclaimer: 'b' })), null)
  assert.equal(parsePendingRecord(JSON.stringify({ revision: 'r', userAgreement: 'a' })), null)
})

test('agreement revision matches the archived evidence revision', async () => {
  const agreementModule = await import('../src/lib/agreements.mjs')
  const { agreementTexts } = await import('../tools/agreements-texts.mjs')
  assert.equal(agreementTexts.length, 2)
  assert.match(agreementTexts[0].body, new RegExp(`协议修订号：${agreementModule.AGREEMENT_REVISION}`))
  assert.match(agreementTexts[1].body, new RegExp(`协议修订号：${agreementModule.AGREEMENT_REVISION}`))
  // 与服务端归档 manifest 同口径的哈希必须可以稳定计算
  assert.match(computeAgreementHash(agreementTexts.map((agreement) => agreement.body)), /^[0-9a-f]{64}$/)
})
