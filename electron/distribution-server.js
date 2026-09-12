// 全应用唯一的分发服务器地址出处。
// 其他模块必须通过 buildServerUrl 拼接服务器地址，禁止再硬编码域名。
const SERVER_ORIGIN = 'https://jianchihu.online'
const SERVER_HOSTNAME = new URL(SERVER_ORIGIN).hostname

function buildServerUrl(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) {
    throw new Error(`分发服务器地址路径必须以 / 开头：${pathname}`)
  }
  return `${SERVER_ORIGIN}${pathname}`
}

module.exports = {
  SERVER_HOSTNAME,
  SERVER_ORIGIN,
  buildServerUrl
}
