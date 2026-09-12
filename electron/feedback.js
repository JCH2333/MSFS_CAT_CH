const fsp = require('node:fs/promises')
const path = require('node:path')
const { buildServerUrl } = require('./distribution-server')

const FEEDBACK_ENDPOINT_PATH = '/api/feedback'
const FEEDBACK_MAX_CONTENT_LENGTH = 2000
const FEEDBACK_MAX_IMAGES = 4
const FEEDBACK_MAX_IMAGE_BYTES = 8 * 1024 * 1024
const FEEDBACK_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const FEEDBACK_IMAGE_MIME_TYPES = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

// 仅凭文件字节判断图片格式，不信任用户提供的文件名或扩展名。
function detectImageFormat(bytes) {
  if (!Buffer.isBuffer(bytes)) return null
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }
  if (bytes.length >= 12
    && bytes.toString('latin1', 0, 4) === 'RIFF'
    && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp'
  }
  return null
}

function invalidImage(index, message) {
  return { ok: false, message: `第 ${index + 1} 张截图${message}` }
}

function validateFeedbackPayload(payload = {}) {
  const content = typeof payload?.content === 'string' ? payload.content.trim() : ''
  if (!content) return { ok: false, message: '请填写反馈内容' }
  if (content.length > FEEDBACK_MAX_CONTENT_LENGTH) {
    return { ok: false, message: `反馈内容不能超过 ${FEEDBACK_MAX_CONTENT_LENGTH} 字` }
  }

  const images = payload?.images
  if (images === undefined || images === null) return { ok: true, content, images: [] }
  if (!Array.isArray(images)) return { ok: false, message: '截图数据无效' }
  if (images.length > FEEDBACK_MAX_IMAGES) {
    return { ok: false, message: `截图最多 ${FEEDBACK_MAX_IMAGES} 张` }
  }

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]
    if (typeof image !== 'string' || image.trim() === '') {
      return invalidImage(index, '数据无效')
    }
    const bytes = Buffer.from(image, 'base64')
    if (bytes.length === 0) return invalidImage(index, '数据无效')
    if (bytes.length > FEEDBACK_MAX_IMAGE_BYTES) return invalidImage(index, '不能超过 8MB')
    if (!detectImageFormat(bytes)) return invalidImage(index, '必须是 png、jpg、jpeg 或 webp 图片')
  }

  return { ok: true, content, images: [...images] }
}

async function submitFeedback(payload, { fetchImpl = globalThis.fetch } = {}) {
  const validated = validateFeedbackPayload(payload)
  if (!validated.ok) return validated
  if (typeof fetchImpl !== 'function') {
    return { ok: false, message: '当前环境无法提交反馈' }
  }

  let response
  try {
    response = await fetchImpl(buildServerUrl(FEEDBACK_ENDPOINT_PATH), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: validated.content, images: validated.images })
    })
  } catch {
    return { ok: false, message: '暂时无法连接反馈服务器，请检查网络后重试' }
  }

  if (response.ok) return { ok: true }
  if (response.status === 429) return { ok: false, reason: 'rate-limited' }

  let serverMessage = ''
  try {
    const data = await response.json()
    if (data && typeof data.message === 'string' && data.message.trim()) serverMessage = data.message.trim()
  } catch {
    // 服务端未返回 JSON 时使用通用失败文案。
  }
  return { ok: false, message: serverMessage || `反馈提交失败（HTTP ${response.status}），请稍后再试` }
}

async function loadFeedbackImages(filePaths, readFileImpl = fsp.readFile) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return []
  if (filePaths.length > FEEDBACK_MAX_IMAGES) {
    throw new Error(`一次最多选择 ${FEEDBACK_MAX_IMAGES} 张截图`)
  }

  const images = []
  for (const filePath of filePaths) {
    if (typeof filePath !== 'string' || !FEEDBACK_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      throw new Error('截图仅支持 png、jpg、jpeg、webp 格式')
    }
    const bytes = await readFileImpl(filePath)
    if (bytes.length > FEEDBACK_MAX_IMAGE_BYTES) {
      throw new Error(`截图不能超过 8MB：${path.basename(filePath)}`)
    }
    const format = detectImageFormat(bytes)
    if (!format) {
      throw new Error(`截图内容不是有效的 png、jpg、jpeg 或 webp 图片：${path.basename(filePath)}`)
    }
    images.push({
      name: path.basename(filePath),
      type: FEEDBACK_IMAGE_MIME_TYPES[format],
      base64: bytes.toString('base64')
    })
  }
  return images
}

module.exports = {
  FEEDBACK_ENDPOINT_PATH,
  FEEDBACK_MAX_CONTENT_LENGTH,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_IMAGES,
  detectImageFormat,
  loadFeedbackImages,
  submitFeedback,
  validateFeedbackPayload
}
