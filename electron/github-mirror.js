const PATCH_RELEASE_PREFIX = '/JCH2333/MSFS_CAT_CH_PATCHES/releases/download/'
const CATALOG_RAW_URL = 'https://raw.githubusercontent.com/JCH2333/MSFS_CAT_CH_PATCHES/main/manifest.json'
const MIRROR_ORIGIN = 'https://ghfast.top/'

function isOfficialPatchReleaseUrl(input) {
  try {
    const url = new URL(input)
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith(PATCH_RELEASE_PREFIX)
  } catch {
    return false
  }
}

function mirrorGitHubUrl(input) {
  const url = new URL(input)
  if (url.protocol !== 'https:' || !['github.com', 'raw.githubusercontent.com'].includes(url.hostname)) {
    throw new Error('只能为 GitHub 下载地址生成镜像链接')
  }
  return `${MIRROR_ORIGIN}${url.toString()}`
}

function isTrustedMirrorUrl(input) {
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.hostname !== 'ghfast.top') return false
    return isOfficialPatchReleaseUrl(url.pathname.slice(1))
  } catch {
    return false
  }
}

function isTimeoutError(error) {
  return error?.code === 'ETIMEDOUT' || error?.name === 'TimeoutError' || /timed out|超时/i.test(error?.message || '')
}

module.exports = {
  CATALOG_RAW_URL,
  MIRROR_ORIGIN,
  isOfficialPatchReleaseUrl,
  isTimeoutError,
  isTrustedMirrorUrl,
  mirrorGitHubUrl
}
