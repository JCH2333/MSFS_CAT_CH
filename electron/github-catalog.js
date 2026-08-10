const fs = require('node:fs/promises')
const path = require('node:path')
const { isSemanticVersion } = require('./versioning')
const { CATALOG_RAW_URL, isTimeoutError, mirrorGitHubUrl } = require('./github-mirror')

const CATALOG_URL = CATALOG_RAW_URL
const PATCH_RELEASE_BASE = 'https://github.com/JCH2333/MSFS_CAT_CH_PATCHES/releases/download'
const PATCH_STATUSES = new Set(['planned', 'published', 'withdrawn'])
const DISPLAYED_PATCH_IDS = new Set(['gsx-pro-zh-cn', 'gsx-pro-zh-cn-voice'])
const TARGET_KINDS = new Set(['addon', 'gsx-audio'])

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} 必须是非空字符串`)
  }
  return value.trim()
}

function validatePackage(packageInfo, patchId) {
  if (!packageInfo || typeof packageInfo !== 'object') {
    throw new Error(`补丁 ${patchId} 缺少 package`)
  }

  const releaseTag = assertString(packageInfo.releaseTag, `补丁 ${patchId} package.releaseTag`)
  const assetName = assertString(packageInfo.assetName, `补丁 ${patchId} package.assetName`)
  const sha256 = assertString(packageInfo.sha256, `补丁 ${patchId} package.sha256`).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`补丁 ${patchId} 的 SHA-256 格式无效`)
  }

  return {
    releaseTag,
    assetName,
    sha256,
    size: Number.isFinite(packageInfo.size) && packageInfo.size >= 0 ? packageInfo.size : 0,
    contentRoot: typeof packageInfo.contentRoot === 'string' ? packageInfo.contentRoot.trim() : '',
    downloadUrl: `${PATCH_RELEASE_BASE}/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`
  }
}

function validateFingerprint(input, patchId) {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw new Error(`补丁 ${patchId} fingerprint 必须是数组`)

  const paths = new Set()
  return input.map((file, index) => {
    const relativePath = assertString(file?.relativePath, `补丁 ${patchId} fingerprint[${index}].relativePath`)
    const segments = relativePath.split('/')
    if (segments.length === 0 || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
      throw new Error(`补丁 ${patchId} fingerprint 路径无效`)
    }
    if (paths.has(relativePath)) throw new Error(`补丁 ${patchId} fingerprint 路径重复`)
    paths.add(relativePath)

    const sha256 = assertString(file?.sha256, `补丁 ${patchId} fingerprint[${index}].sha256`).toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`补丁 ${patchId} fingerprint SHA-256 无效`)
    return { relativePath, sha256 }
  })
}

function validateCatalog(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('补丁目录不是有效对象')
  }
  if (input.schemaVersion !== 1) {
    throw new Error(`不支持的补丁目录版本：${input.schemaVersion ?? '未知'}`)
  }
  if (!Array.isArray(input.patches)) {
    throw new Error('补丁目录缺少 patches 数组')
  }

  const ids = new Set()
  const patches = input.patches.map((patch, index) => {
    const id = assertString(patch?.id, `patches[${index}].id`)
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
      throw new Error(`补丁 ID 格式无效：${id}`)
    }
    if (ids.has(id)) {
      throw new Error(`补丁 ID 重复：${id}`)
    }
    ids.add(id)

    const status = assertString(patch.status, `补丁 ${id} status`).toLowerCase()
    if (!PATCH_STATUSES.has(status)) {
      throw new Error(`补丁 ${id} 状态无效：${status}`)
    }

    return {
      id,
      name: assertString(patch.name, `补丁 ${id} name`),
      summary: typeof patch.summary === 'string' ? patch.summary.trim() : '',
      version: (() => {
        const version = assertString(patch.version, `补丁 ${id} version`)
        if (!isSemanticVersion(version)) {
          throw new Error(`补丁 ${id} version 必须采用语义化格式`)
        }
        return version
      })(),
      addonVersion: (() => {
        if (patch.addonVersion === undefined || patch.addonVersion === null || patch.addonVersion === '') return null
        const addonVersion = assertString(patch.addonVersion, `补丁 ${id} addonVersion`)
        if (!isSemanticVersion(addonVersion)) {
          throw new Error(`补丁 ${id} addonVersion 必须采用语义化格式`)
        }
        return addonVersion
      })(),
      status,
      compatibility: Array.isArray(patch.compatibility)
        ? patch.compatibility.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
        : [],
      targetHint: typeof patch.targetHint === 'string' ? patch.targetHint.trim() : '请选择安装目录',
      targetFolders: Array.isArray(patch.targetFolders)
        ? [...new Set(patch.targetFolders.filter((folder) => typeof folder === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(folder.trim())).map((folder) => folder.trim()))]
        : [],
      targetKind: TARGET_KINDS.has(patch.targetKind) ? patch.targetKind : 'addon',
      releaseNotes: Array.isArray(patch.releaseNotes)
        ? patch.releaseNotes.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
        : [],
      fingerprint: validateFingerprint(patch.fingerprint, id),
      package: status === 'published' ? validatePackage(patch.package, id) : null
    }
  }).filter((patch) => DISPLAYED_PATCH_IDS.has(patch.id))

  return {
    schemaVersion: 1,
    catalogVersion: assertString(input.catalogVersion, 'catalogVersion'),
    updatedAt: assertString(input.updatedAt, 'updatedAt'),
    patches
  }
}

class GitHubCatalog {
  constructor({ cacheDirectory, fetchImpl = globalThis.fetch, catalogUrl = CATALOG_URL }) {
    this.cacheDirectory = cacheDirectory
    this.cachePath = path.join(cacheDirectory, 'patch-catalog.json')
    this.fetchImpl = fetchImpl
    this.catalogUrl = catalogUrl
  }

  async readCache() {
    try {
      return validateCatalog(JSON.parse(await fs.readFile(this.cachePath, 'utf8')))
    } catch {
      return null
    }
  }

  async writeCache(catalog) {
    await fs.mkdir(this.cacheDirectory, { recursive: true })
    const temporaryPath = `${this.cachePath}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify(catalog, null, 2), 'utf8')
    await fs.rename(temporaryPath, this.cachePath)
  }

  async fetchCatalog(url) {
    const response = await this.fetchImpl(`${url}?t=${Date.now()}`, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'msfs-cat-ch'
      },
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      throw new Error(`GitHub 返回 HTTP ${response.status}`)
    }
    return validateCatalog(await response.json())
  }

  async refresh() {
    try {
      const catalog = await this.fetchCatalog(this.catalogUrl)
      await this.writeCache(catalog)
      return { catalog, source: 'github', stale: false, error: null }
    } catch (error) {
      if (isTimeoutError(error)) {
        try {
          const catalog = await this.fetchCatalog(mirrorGitHubUrl(this.catalogUrl))
          await this.writeCache(catalog)
          return { catalog, source: 'mirror', stale: false, error: null }
        } catch (mirrorError) {
          error = new Error(`GitHub 超时，国内镜像也无法访问：${mirrorError.message}`)
        }
      }
      const cached = await this.readCache()
      if (cached) {
        return { catalog: cached, source: 'cache', stale: true, error: error.message }
      }
      throw new Error(`无法读取 GitHub 补丁目录：${error.message}`)
    }
  }
}

module.exports = {
  CATALOG_URL,
  DISPLAYED_PATCH_IDS,
  GitHubCatalog,
  validateCatalog
}
