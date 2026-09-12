const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  FEEDBACK_ENDPOINT_PATH,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_IMAGES,
  detectImageFormat,
  loadFeedbackImages,
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

  assert.deepEqual(result, { ok: true, content: '安装补丁后界面乱码', images: [PNG_BASE64] })
})

test('treats missing images as an empty list', () => {
  const result = validateFeedbackPayload({ content: '没有截图的反馈' })

  assert.deepEqual(result, { ok: true, content: '没有截图的反馈', images: [] })
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

test('rejects more than four images', () => {
  const result = validateFeedbackPayload({
    content: '太多截图',
    images: [PNG_BASE64, PNG_BASE64, PNG_BASE64, PNG_BASE64, PNG_BASE64]
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /最多 4 张/)
  assert.equal(FEEDBACK_MAX_IMAGES, 4)
})

test('rejects an image larger than 8MB after base64 decoding', () => {
  const oversized = Buffer.alloc(FEEDBACK_MAX_IMAGE_BYTES + 1, 0x89)
  const result = validateFeedbackPayload({ content: '超大截图', images: [oversized.toString('base64')] })

  assert.equal(result.ok, false)
  assert.match(result.message, /8MB/)
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

test('submits the payload to the server feedback endpoint', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return feedbackResponse(200, { ok: true })
  }

  const result = await submitFeedback({ content: '无法下载补丁', images: [PNG_BASE64] }, { fetchImpl })

  assert.deepEqual(result, { ok: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${SERVER_ORIGIN}${FEEDBACK_ENDPOINT_PATH}`)
  assert.equal(calls[0].url, 'https://jianchihu.online/api/feedback')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].options.body), { content: '无法下载补丁', images: [PNG_BASE64] })
})

test('returns ok true for any 2xx response', async () => {
  const result = await submitFeedback({ content: '感谢支持', images: [] }, { fetchImpl: async () => feedbackResponse(204) })

  assert.deepEqual(result, { ok: true })
})

test('reports rate limiting on HTTP 429', async () => {
  const result = await submitFeedback({ content: '今日第三次反馈' }, { fetchImpl: async () => feedbackResponse(429, { message: 'too many' }) })

  assert.deepEqual(result, { ok: false, reason: 'rate-limited' })
})

test('surfaces the server message for other failures', async () => {
  const result = await submitFeedback({ content: '包含违规内容' }, { fetchImpl: async () => feedbackResponse(400, { message: '内容包含敏感词' }) })

  assert.deepEqual(result, { ok: false, message: '内容包含敏感词' })
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

test('rejects more than four selected screenshots immediately', async () => {
  const paths = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png']

  await assert.rejects(loadFeedbackImages(paths), /最多选择 4 张/)
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

  await assert.rejects(loadFeedbackImages([bigPath]), /8MB/)
  await fs.rm(root, { recursive: true, force: true })
})
