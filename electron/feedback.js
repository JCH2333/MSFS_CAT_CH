const fsp = require('node:fs/promises')
const path = require('node:path')
const { buildServerUrl } = require('./distribution-server')

const FEEDBACK_ENDPOINT_PATH = '/api/feedback'
const FEEDBACK_QUERY_ENDPOINT_PREFIX = '/api/feedback/query/'
const FEEDBACK_MAX_CONTENT_LENGTH = 2000
const FEEDBACK_MAX_USERNAME_LENGTH = 50
const FEEDBACK_MAX_IMAGES = 10
const FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024
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

  // 可选用户名：trim 后为空按匿名提交
  const username = typeof payload?.username === 'string' ? payload.username.trim() : ''
  if (username.length > FEEDBACK_MAX_USERNAME_LENGTH) {
    return { ok: false, message: `用户名不能超过 ${FEEDBACK_MAX_USERNAME_LENGTH} 字` }
  }

  const images = payload?.images
  if (images === undefined || images === null) return { ok: true, content, username, images: [] }
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
    if (bytes.length > FEEDBACK_MAX_IMAGE_BYTES) return invalidImage(index, '不能超过 5MB')
    if (!detectImageFormat(bytes)) return invalidImage(index, '必须是 png、jpg、jpeg 或 webp 图片')
  }

  return { ok: true, content, username, images: [...images] }
}

async function submitFeedback(payload, { fetchImpl = globalThis.fetch } = {}) {
  const validated = validateFeedbackPayload(payload)
  if (!validated.ok) return validated
  if (typeof fetchImpl !== 'function') {
    return { ok: false, message: '当前环境无法提交反馈' }
  }

  // 可选运行日志（主进程自动附带）：服务端 256KB 上限，超出截尾保留后半
  const logText = typeof payload?.logText === 'string' && payload.logText.trim()
    ? payload.logText.slice(-262144)
    : null
  const gameLogText = typeof payload?.gameLogText === 'string' && payload.gameLogText.trim()
    ? payload.gameLogText.slice(-262144)
    : null

  let response
  try {
    response = await fetchImpl(buildServerUrl(FEEDBACK_ENDPOINT_PATH), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: validated.content,
        username: validated.username,
        images: validated.images,
        ...(logText ? { logText } : {}),
        ...(gameLogText ? { gameLogText } : {})
      })
    })
  } catch {
    return { ok: false, message: '暂时无法连接反馈服务器，请检查网络后重试' }
  }

  if (response.ok) {
    // 服务端在 data 中返回反馈码，用户凭它查询处理进度
    let feedbackCode = ''
    try {
      const body = await response.json()
      const code = body?.data?.feedbackCode
      if (typeof code === 'string') feedbackCode = code
    } catch {
      // 服务端未返回 JSON 时仍视为提交成功，只是拿不到反馈码
    }
    return { ok: true, feedbackCode }
  }
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

/**
 * 凭反馈码查询处理进度。
 * 返回 { ok:true, status, createdAt, username, adminReply }；
 * NOT_FOUND / EXPIRED 也是 ok:true 的 status（服务端以 200 返回 statusCode）。
 * 失败时返回 { ok:false, error }。
 */
async function queryFeedback(code, { fetchImpl = globalThis.fetch } = {}) {
  const trimmed = typeof code === 'string' ? code.trim() : ''
  if (!trimmed) return { ok: false, error: '请输入反馈码' }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: '当前环境无法查询反馈进度' }
  }

  let response
  try {
    response = await fetchImpl(
      buildServerUrl(FEEDBACK_QUERY_ENDPOINT_PREFIX) + encodeURIComponent(trimmed),
      { method: 'GET' }
    )
  } catch {
    return { ok: false, error: '暂时无法连接反馈服务器，请检查网络后重试' }
  }

  if (!response.ok) {
    // 服务端业务限流以 HTTP 400 + code=429 返回
    let body = null
    try {
      body = await response.json()
    } catch {
      // 无 JSON 时按状态码处理
    }
    if (response.status === 429 || body?.code === 429) {
      return { ok: false, error: '今日查询次数已达上限（每天 60 次），请明天再试' }
    }
    return { ok: false, error: `反馈查询失败（HTTP ${response.status}），请稍后再试` }
  }

  try {
    const body = await response.json()
    const data = body?.data
    if (body?.code === 200 && data && typeof data.statusCode === 'string') {
      return {
        ok: true,
        status: data.statusCode,
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
        username: typeof data.username === 'string' && data.username ? data.username : '匿名',
        adminReply: typeof data.adminReply === 'string' ? data.adminReply : ''
      }
    }
    return { ok: false, error: '反馈服务器返回数据异常，请稍后再试' }
  } catch {
    return { ok: false, error: '反馈服务器返回数据异常，请稍后再试' }
  }
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
      throw new Error(`截图不能超过 5MB：${path.basename(filePath)}`)
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
  FEEDBACK_QUERY_ENDPOINT_PREFIX,
  FEEDBACK_MAX_CONTENT_LENGTH,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_USERNAME_LENGTH,
  detectImageFormat,
  loadFeedbackImages,
  queryFeedback,
  submitFeedback,
  validateFeedbackPayload
}
