const fs = require('node:fs/promises')
const path = require('node:path')

const CATALOG_URL = 'https://api.github.com/repos/JCH2333/gsx-chinese-patches/contents/manifest.json'
const PATCH_RELEASE_BASE = 'https://github.com/JCH2333/gsx-chinese-patches/releases/download'
const PATCH_STATUSES = new Set(['planned', 'published', 'withdrawn'])

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
      version: assertString(patch.version, `补丁 ${id} version`),
      status,
      compatibility: Array.isArray(patch.compatibility)
        ? patch.compatibility.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
        : [],
      targetHint: typeof patch.targetHint === 'string' ? patch.targetHint.trim() : '请选择安装目录',
      releaseNotes: Array.isArray(patch.releaseNotes)
        ? patch.releaseNotes.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
        : [],
      package: status === 'published' ? validatePackage(patch.package, id) : null
    }
  })

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

  async refresh() {
    try {
      const response = await this.fetchImpl(`${this.catalogUrl}?t=${Date.now()}`, {
        headers: {
          Accept: 'application/vnd.github.raw+json',
          'User-Agent': 'gsx-chinese-tool'
        },
        signal: AbortSignal.timeout(15000)
      })
      if (!response.ok) {
        throw new Error(`GitHub 返回 HTTP ${response.status}`)
      }
      const catalog = validateCatalog(await response.json())
      await this.writeCache(catalog)
      return { catalog, source: 'github', stale: false, error: null }
    } catch (error) {
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
  GitHubCatalog,
  validateCatalog
}
