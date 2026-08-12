const PATCH_RELEASE_PREFIX = '/JCH2333/MSFS_CAT_CH_PATCHES/releases/download/'
const CATALOG_RAW_URL = 'https://raw.githubusercontent.com/JCH2333/MSFS_CAT_CH_PATCHES/main/manifest.json'
const GITEE_PATCH_RELEASE_PREFIX = '/ljd123456/MSFS_CAT_CH_PATCHES/releases/download/'
const GITEE_CATALOG_RAW_URL = 'https://gitee.com/ljd123456/MSFS_CAT_CH_PATCHES/raw/main/manifest.json'
const GITEE_PATCH_RELEASE_BASE = 'https://gitee.com/ljd123456/MSFS_CAT_CH_PATCHES/releases/download'
const MIRROR_ORIGIN = 'https://ghfast.top/'
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH'
])

function isOfficialPatchReleaseUrl(input) {
  try {
    const url = new URL(input)
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith(PATCH_RELEASE_PREFIX)
  } catch {
    return false
  }
}

function isOfficialGiteePatchReleaseUrl(input) {
  try {
    const url = new URL(input)
    return url.protocol === 'https:' && url.hostname === 'gitee.com' && url.pathname.startsWith(GITEE_PATCH_RELEASE_PREFIX)
  } catch {
    return false
  }
}

function githubFallbackForGiteePatchUrl(input) {
  const url = new URL(input)
  if (!isOfficialGiteePatchReleaseUrl(url)) throw new Error('只能为官方 Gitee 补丁地址生成 GitHub 备用地址')
  return `https://github.com/JCH2333/MSFS_CAT_CH_PATCHES/releases/download/${url.pathname.slice(GITEE_PATCH_RELEASE_PREFIX.length)}`
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
  return RETRYABLE_NETWORK_ERROR_CODES.has(error?.code)
    || error?.name === 'TimeoutError'
    || /timed out|超时/i.test(error?.message || '')
}

module.exports = {
  CATALOG_RAW_URL,
  GITEE_CATALOG_RAW_URL,
  GITEE_PATCH_RELEASE_BASE,
  MIRROR_ORIGIN,
  githubFallbackForGiteePatchUrl,
  isOfficialGiteePatchReleaseUrl,
  isOfficialPatchReleaseUrl,
  isTimeoutError,
  isTrustedMirrorUrl,
  mirrorGitHubUrl
}
