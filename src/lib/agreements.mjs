export const AUTHOR_NAME = 'B站 一只剑齿虎呀'
export const AUTHOR_URL = 'https://space.bilibili.com/472309803?spm_id_from=333.1007.0.0'

// Increment this value whenever the agreement text or the legal basis for use changes.
// A new value deliberately requires every existing installation to consent again.
export const AGREEMENT_REVISION = '2026-09-17-v1'
export const AGREEMENT_ACCEPTANCE_VALUE = `accepted-${AGREEMENT_REVISION}`

const ACCEPTED_PREFIX = 'accepted-'
const REVISION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

// 2.1.1 起同意值不再绑定编译期内置修订号：软件接受服务器推送的更新修订版，
// localStorage 记录形如 accepted-<revision>。内置修订号只决定首次安装的初始文本，
// 之后的强制重新同意由服务器 latest-revision 驱动（见 electron/agreements-secure.js）。
export function acceptanceValue(revision) {
  return `${ACCEPTED_PREFIX}${typeof revision === 'string' ? revision : ''}`
}

export function parseAcceptedAgreementRevision(value) {
  if (typeof value !== 'string' || !value.startsWith(ACCEPTED_PREFIX)) return null
  const revision = value.slice(ACCEPTED_PREFIX.length)
  return REVISION_PATTERN.test(revision) ? revision : null
}

export function hasAcceptedAgreements(value) {
  return value === AGREEMENT_ACCEPTANCE_VALUE
}

// 协议章节元数据（仅标题，不含正文）。
// 自客户端 2.0 起协议正文不再打进安装包：正文在构建时由 tools/encrypt-agreements.mjs
// 加密进 electron/resources/agreements-enc.json，运行时由主进程向分发服务器取钥解密
// （见 electron/agreements-secure.js），经 IPC legal:get-agreement-text 提供正文。
// 协议全文的唯一文本源在 tools/agreements-texts.mjs，不参与打包。
// 自 2.1.1 起服务器可推送更新的修订版正文（经作者签名校验），弹窗正文不限于内置修订版。
export const AGREEMENT_SECTIONS = [
  { id: 'user', title: '用户使用协议' },
  { id: 'notice', title: '免责声明' }
]
