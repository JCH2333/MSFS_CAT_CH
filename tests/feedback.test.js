const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  FEEDBACK_ENDPOINT_PATH,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_USERNAME_LENGTH,
  FEEDBACK_QUERY_ENDPOINT_PREFIX,
  detectImageFormat,
  loadFeedbackImages,
  queryFeedback,
  submitFeedback,
  validateFeedbackPayload
} = require('../electron/feedback')
const { SERVER_ORIGIN } = require('../electron/distribution-server')

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const WEBP_BYTES = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from('VP8 ')])
const PNG_BASE64 = PNG_BYTES.toString('base64')

function feedbackResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }
}

test('detects png, jpeg, and webp images by magic bytes only', () => {
  assert.equal(detectImageFormat(PNG_BYTES), 'png')
  assert.equal(detectImageFormat(JPEG_BYTES), 'jpeg')
  assert.equal(detectImageFormat(WEBP_BYTES), 'webp')
  assert.equal(detectImageFormat(Buffer.from('fake image with .png extension')), null)
  assert.equal(detectImageFormat(Buffer.alloc(0)), null)
})

test('accepts a valid feedback payload and trims the content', () => {
  const result = validateFeedbackPayload({ content: '  安装补丁后界面乱码  ', images: [PNG_BASE64] })

  assert.deepEqual(result, { ok: true, content: '安装补丁后界面乱码', username: '', email: '', images: [PNG_BASE64] })
})

test('keeps a provided username after trimming', () => {
  const result = validateFeedbackPayload({ content: '带用户名的反馈', username: '  飞行员小王  ' })

  assert.deepEqual(result, { ok: true, content: '带用户名的反馈', username: '飞行员小王', email: '', images: [] })
})

test('treats a blank username as anonymous', () => {
  assert.equal(validateFeedbackPayload({ content: '匿名反馈', username: '   ' }).username, '')
  assert.equal(validateFeedbackPayload({ content: '没有用户名字段的反馈' }).username, '')
  assert.equal(validateFeedbackPayload({ content: '用户名不是字符串', username: 42 }).username, '')
})

test('rejects a username longer than 50 characters', () => {
  const result = validateFeedbackPayload({ content: 'x', username: 'a'.repeat(FEEDBACK_MAX_USERNAME_LENGTH + 1) })

  assert.equal(result.ok, false)
  assert.match(result.message, /50/)
})

test('treats missing images as an empty list', () => {
  const result = validateFeedbackPayload({ content: '没有截图的反馈' })

  assert.deepEqual(result, { ok: true, content: '没有截图的反馈', username: '', email: '', images: [] })
})

test('rejects empty or whitespace-only content', () => {
  assert.equal(validateFeedbackPayload({ content: '' }).ok, false)
  assert.equal(validateFeedbackPayload({ content: '   \n  ' }).ok, false)
  assert.equal(validateFeedbackPayload({}).ok, false)
  assert.equal(validateFeedbackPayload({ content: 42 }).ok, false)
})

test('rejects content longer than 2000 characters', () => {
  const result = validateFeedbackPayload({ content: 'a'.repeat(2001) })

  assert.equal(result.ok, false)
  assert.match(result.message, /2000/)
})

test('rejects more than ten images', () => {
  const elevenImages = Array.from({ length: FEEDBACK_MAX_IMAGES + 1 }, () => PNG_BASE64)
  const result = validateFeedbackPayload({ content: '太多截图', images: elevenImages })

  assert.equal(result.ok, false)
  assert.match(result.message, /最多 10 张/)
  assert.equal(FEEDBACK_MAX_IMAGES, 10)
})

test('accepts exactly ten images', () => {
  const tenImages = Array.from({ length: 10 }, () => PNG_BASE64)
  const result = validateFeedbackPayload({ content: '正好十张截图', images: tenImages })

  assert.equal(result.ok, true)
  assert.equal(result.images.length, 10)
})

test('rejects an image larger than 5MB after base64 decoding', () => {
  const oversized = Buffer.alloc(FEEDBACK_MAX_IMAGE_BYTES + 1, 0x89)
  const result = validateFeedbackPayload({ content: '超大截图', images: [oversized.toString('base64')] })

  assert.equal(result.ok, false)
  assert.match(result.message, /5MB/)
})

test('rejects an image whose bytes are not a supported image format', () => {
  const fakePng = Buffer.from('definitely not a real png image payload')
  const result = validateFeedbackPayload({ content: '伪造的截图', images: [fakePng.toString('base64')] })

  assert.equal(result.ok, false)
  assert.match(result.message, /png/)
})

test('rejects non-string or empty image entries', () => {
  assert.equal(validateFeedbackPayload({ content: 'x', images: [42] }).ok, false)
  assert.equal(validateFeedbackPayload({ content: 'x', images: [''] }).ok, false)
  assert.equal(validateFeedbackPayload({ content: 'x', images: 'not-an-array' }).ok, false)
})

test('submits the payload to the server feedback endpoint with the username', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return feedbackResponse(200, { code: 200, data: { feedbackCode: 'FB-AB34CD' } })
  }

  const result = await submitFeedback(
    { content: '无法下载补丁', username: '飞行员', images: [PNG_BASE64] },
    { fetchImpl }
  )

  assert.deepEqual(result, { ok: true, feedbackCode: 'FB-AB34CD' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${SERVER_ORIGIN}${FEEDBACK_ENDPOINT_PATH}`)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    content: '无法下载补丁',
    username: '飞行员',
    images: [PNG_BASE64]
  })
})

test('submits an empty username for anonymous feedback', async () => {
  let body = null
  const fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body)
    return feedbackResponse(200, { code: 200, data: { feedbackCode: 'FB-XY78ZV' } })
  }

  const result = await submitFeedback({ content: '匿名反馈' }, { fetchImpl })

  assert.equal(result.ok, true)
  assert.equal(body.username, '')
})

test('returns ok true with an empty feedback code when the body is unusable', async () => {
  const response = feedbackResponse(204, undefined)
  response.json = async () => { throw new Error('no json') }
  const result = await submitFeedback({ content: '感谢支持', images: [] }, { fetchImpl: async () => response })

  assert.deepEqual(result, { ok: true, feedbackCode: '' })
})

test('reports rate limiting on HTTP 429', async () => {
  const result = await submitFeedback({ content: '今日第三次反馈' }, { fetchImpl: async () => feedbackResponse(429, { message: 'too many' }) })

  assert.deepEqual(result, { ok: false, reason: 'rate-limited' })
})

test('surfaces the server message for other failures', async () => {
  const result = await submitFeedback({ content: '包含违规内容' }, { fetchImpl: async () => feedbackResponse(400, { message: '内容包含敏感词' }) })

  assert.equal(result.ok, false)
  assert.equal(result.message, '内容包含敏感词')
})

test('falls back to a generic message when the failure body is not usable JSON', async () => {
  const response = feedbackResponse(500, undefined)
  response.json = async () => { throw new Error('invalid json') }
  const result = await submitFeedback({ content: '服务器错误' }, { fetchImpl: async () => response })

  assert.equal(result.ok, false)
  assert.match(result.message, /HTTP 500/)
})

test('reports an unreachable feedback server without throwing', async () => {
  const result = await submitFeedback({ content: '网络中断' }, { fetchImpl: async () => { throw new Error('ECONNRESET') } })

  assert.equal(result.ok, false)
  assert.match(result.message, /无法连接反馈服务器/)
})

test('validates the payload before touching the network', async () => {
  let called = 0
  const result = await submitFeedback({ content: '' }, { fetchImpl: async () => { called += 1; return feedbackResponse(200) } })

  assert.equal(result.ok, false)
  assert.equal(called, 0)
})

test('queries a pending feedback by code', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return feedbackResponse(200, {
      code: 200,
      data: { statusCode: 'PENDING', createdAt: '2026-09-14 10:00:00', username: '匿名', adminReply: null }
    })
  }

  const result = await queryFeedback('  fb-ab34cd  ', { fetchImpl })

  assert.deepEqual(result, {
    ok: true,
    status: 'PENDING',
    createdAt: '2026-09-14 10:00:00',
    username: '匿名',
    adminReply: ''
  })
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].url, `${SERVER_ORIGIN}${FEEDBACK_QUERY_ENDPOINT_PREFIX}fb-ab34cd`)
})

test('queries a processed feedback with the admin reply', async () => {
  const fetchImpl = async () => feedbackResponse(200, {
    code: 200,
    data: { statusCode: 'PROCESSED', createdAt: '2026-09-14 10:00:00', username: '飞行员', adminReply: '已在新版本修复' }
  })

  const result = await queryFeedback('FB-AB34CD', { fetchImpl })

  assert.deepEqual(result, {
    ok: true,
    status: 'PROCESSED',
    createdAt: '2026-09-14 10:00:00',
    username: '飞行员',
    adminReply: '已在新版本修复'
  })
})

test('treats NOT_FOUND as a successful query with that status', async () => {
  const fetchImpl = async () => feedbackResponse(200, {
    code: 200,
    data: { statusCode: 'NOT_FOUND', createdAt: null, username: '匿名', adminReply: null }
  })

  const result = await queryFeedback('FB-ZZZZZZ', { fetchImpl })

  assert.equal(result.ok, true)
  assert.equal(result.status, 'NOT_FOUND')
})

test('treats EXPIRED as a successful query with that status', async () => {
  const fetchImpl = async () => feedbackResponse(200, {
    code: 200,
    data: { statusCode: 'EXPIRED', createdAt: '2026-08-01 10:00:00', username: '匿名', adminReply: null }
  })

  const result = await queryFeedback('FB-OLD123', { fetchImpl })

  assert.equal(result.ok, true)
  assert.equal(result.status, 'EXPIRED')
})

test('surfaces the query rate limit error', async () => {
  const fetchImpl = async () => feedbackResponse(400, { code: 429, message: '今日反馈查询次数已达上限' })

  const result = await queryFeedback('FB-AB34CD', { fetchImpl })

  assert.equal(result.ok, false)
  assert.match(result.error, /今日查询次数已达上限/)
})

test('reports an unreachable server when querying without throwing', async () => {
  const result = await queryFeedback('FB-AB34CD', { fetchImpl: async () => { throw new Error('ETIMEDOUT') } })

  assert.equal(result.ok, false)
  assert.match(result.error, /无法连接反馈服务器/)
})

test('rejects an empty feedback code before touching the network', async () => {
  let called = 0
  const result = await queryFeedback('   ', { fetchImpl: async () => { called += 1; return feedbackResponse(200) } })

  assert.equal(result.ok, false)
  assert.equal(called, 0)
})

test('rejects non-string feedback codes', async () => {
  const result = await queryFeedback(12345, { fetchImpl: async () => feedbackResponse(200) })

  assert.equal(result.ok, false)
})

test('loads selected screenshot files with names, mime types, and raw base64', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-images-'))
  const pngPath = path.join(root, 'shot.png')
  const jpegPath = path.join(root, 'shot.jpeg')
  await fs.writeFile(pngPath, PNG_BYTES)
  await fs.writeFile(jpegPath, JPEG_BYTES)

  const images = await loadFeedbackImages([pngPath, jpegPath])

  assert.deepEqual(images.map((image) => image.name), ['shot.png', 'shot.jpeg'])
  assert.deepEqual(images.map((image) => image.type), ['image/png', 'image/jpeg'])
  assert.deepEqual(images.map((image) => Buffer.from(image.base64, 'base64')), [PNG_BYTES, JPEG_BYTES])
  await fs.rm(root, { recursive: true, force: true })
})

test('rejects more than ten selected screenshots immediately', async () => {
  const paths = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png', 'g.png', 'h.png', 'i.png', 'j.png', 'k.png']

  await assert.rejects(loadFeedbackImages(paths), /最多选择 10 张/)
})

test('rejects a selected file whose bytes do not match its image extension', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-fake-'))
  const fakePath = path.join(root, 'fake.png')
  await fs.writeFile(fakePath, Buffer.from('plain text disguised as png'))

  await assert.rejects(loadFeedbackImages([fakePath]), /fake\.png/)
  await fs.rm(root, { recursive: true, force: true })
})

test('rejects an oversized selected screenshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-oversize-'))
  const bigPath = path.join(root, 'big.png')
  await fs.writeFile(bigPath, Buffer.concat([PNG_BYTES, Buffer.alloc(FEEDBACK_MAX_IMAGE_BYTES, 0)]))

  await assert.rejects(loadFeedbackImages([bigPath]), /5MB/)
  await fs.rm(root, { recursive: true, force: true })
})

test('email is optional, trimmed, validated and forwarded with the submission', async () => {
  const submittedBodies = []
  const fetchImpl = async (url, options = {}) => {
    submittedBodies.push(JSON.parse(options.body))
    return { ok: true, json: async () => ({ code: 200, data: { feedbackCode: 'FB-TEST01' } }) }
  }

  // 缺省与空白：按未订阅提交（不携带 email 字段）
  assert.equal(validateFeedbackPayload({ content: '问题' }).email, '')
  const result = await submitFeedback({ content: '问题', email: '   ' }, { fetchImpl })
  assert.equal(result.ok, true)
  assert.equal('email' in submittedBodies.at(-1), false)

  // 合法邮箱：trim 后随请求转发
  const withEmail = await submitFeedback({ content: '问题', email: ' user@example.com ' }, { fetchImpl })
  assert.equal(withEmail.ok, true)
  assert.equal(submittedBodies.at(-1).email, 'user@example.com')

  // 非法格式：拒绝且不发请求
  const bad = await submitFeedback({ content: '问题', email: 'not-an-email' }, { fetchImpl })
  assert.equal(bad.ok, false)
  assert.match(bad.message, /邮箱格式不正确/)
  assert.equal(submittedBodies.length, 2)
})

test('sponsor messages payload is sanitized field by field', () => {
  const { sanitizeMessages } = require('../electron/sponsor-messages')
  const cleaned = sanitizeMessages([
    { id: 1, content: '  感谢赞助 '.padEnd(1), displayOrder: 10 },
    { content: 'x'.repeat(300), id: 2 },
    { content: '   ' },
    'not-an-object'
  ])
  assert.equal(cleaned.length, 2)
  assert.equal(cleaned[0].content, '感谢赞助')
  assert.equal(cleaned[1].content.length, 100)
  assert.deepEqual(sanitizeMessages(null), [])
})
