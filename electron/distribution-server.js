// 全应用唯一的分发服务器地址出处。
// 其他模块必须通过 buildServerUrl 拼接服务器地址，禁止再硬编码域名。
//
// 发布策略（ADR-0004 过渡期）：
// - 2.0.0 发布早于 ICP 备案通过，默认源临时指向公网 IP（阿里云 20075 端口）；
// - 备案下来后发布一个小版本，把这里的默认值改回 https://jianchihu.online，
//   通过服务器强制更新让全体用户迁移到域名；
// - MSFS_CAT_CH_SERVER_ORIGIN 环境变量仍可覆盖（联调/提前验证域名用），
//   正式用户不会设置它。
const DEFAULT_SERVER_ORIGIN = 'http://47.109.31.236:20075'

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const url = new URL(value.trim())
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null
    // 统一去掉默认端口与末尾斜杠，保证 origin 比较一致
    const port = url.port && !((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80'))
      ? `:${url.port}`
      : ''
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}`
  } catch {
    return null
  }
}

const SERVER_ORIGIN = normalizeOrigin(process.env.MSFS_CAT_CH_SERVER_ORIGIN) || DEFAULT_SERVER_ORIGIN
const SERVER_HOSTNAME = new URL(SERVER_ORIGIN).hostname

function buildServerUrl(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) {
    throw new Error(`分发服务器地址路径必须以 / 开头：${pathname}`)
  }
  return `${SERVER_ORIGIN}${pathname}`
}

// 判断一个绝对 URL 是否指向配置的分发服务器（协议、主机、端口完全一致）
function isTrustedServerUrl(value) {
  try {
    return normalizeOrigin(value) === SERVER_ORIGIN
  } catch {
    return false
  }
}

// 配置源对应的协议（正式为 https，IP 联调源可能为 http）
function serverOriginProtocol() {
  return SERVER_ORIGIN.startsWith('https:') ? 'https:' : 'http:'
}

module.exports = {
  DEFAULT_SERVER_ORIGIN,
  SERVER_HOSTNAME,
  SERVER_ORIGIN,
  buildServerUrl,
  isTrustedServerUrl,
  normalizeOrigin,
  serverOriginProtocol
}
