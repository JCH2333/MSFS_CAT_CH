export const AUTHOR_NAME = 'B站 一只剑齿虎呀'
export const AUTHOR_URL = 'https://space.bilibili.com/472309803?spm_id_from=333.1007.0.0'

// Increment this value whenever the agreement text or the legal basis for use changes.
// A new value deliberately requires every existing installation to consent again.
export const AGREEMENT_REVISION = '2026-09-15-v1'
export const AGREEMENT_ACCEPTANCE_VALUE = `accepted-${AGREEMENT_REVISION}`

export function hasAcceptedAgreements(value) {
  return value === AGREEMENT_ACCEPTANCE_VALUE
}

// 协议章节元数据（仅标题，不含正文）。
// 自客户端 2.0 起协议正文不再打进安装包：正文在构建时由 tools/encrypt-agreements.mjs
// 加密进 electron/resources/agreements-enc.json，运行时由主进程向分发服务器取钥解密
// （见 electron/agreements-secure.js），经 IPC legal:get-agreement-text 提供正文。
// 协议全文的唯一文本源在 tools/agreements-texts.mjs，不参与打包。
export const AGREEMENT_SECTIONS = [
  { id: 'user', title: '用户使用协议' },
  { id: 'notice', title: '免责声明' }
]
