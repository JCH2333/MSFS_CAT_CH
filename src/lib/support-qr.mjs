const giteeQrUrl = 'https://gitee.com/ljd123456/MSFS_CAT_CH/raw/main/remote-assets/wechat-support.jpg'
const githubQrUrl = 'https://raw.githubusercontent.com/JCH2333/MSFS_CAT_CH/main/remote-assets/wechat-support.jpg'

export const SUPPORT_QR_SOURCES = [
  { source: 'gitee', url: giteeQrUrl },
  { source: 'github', url: githubQrUrl },
  { source: 'mirror', url: `https://ghfast.top/${githubQrUrl}` }
]
