const fs = require('node:fs/promises')
const path = require('node:path')
const { buildServerUrl, isTrustedServerUrl } = require('./distribution-server')
const { isSemanticVersion } = require('./versioning')
const { adjudicateChannelResponse, isEnforceRequired } = require('./channel-signing')

const CATALOG_MANIFEST_PATH = '/api/catalog/manifest.json'
const CATALOG_URL = buildServerUrl(CATALOG_MANIFEST_PATH)
const PATCH_STATUSES = new Set(['planned', 'published', 'withdrawn'])
const TARGET_KINDS = new Set(['addon', 'addon-inject', 'gsx-audio', 'gsx-combined'])
const INSTALL_PLAN_TARGETS = new Set(['primary', 'gsx-runtime-res'])
const CATALOG_TIMEOUT_MS = 12000

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} 必须是非空字符串`)
  }
  return value.trim()
}

function validateInstallPlan(packageInfo, patchId) {
  if (packageInfo.installPlan === undefined) return []
  if (!Array.isArray(packageInfo.installPlan) || packageInfo.installPlan.length === 0) {
    throw new Error(`补丁 ${patchId} package.installPlan 必须是非空数组`)
  }

  const targets = new Set()
  return packageInfo.installPlan.map((entry, index) => {
    const target = assertString(entry?.target, `补丁 ${patchId} package.installPlan[${index}].target`)
    const contentRoot = assertString(entry?.contentRoot, `补丁 ${patchId} package.installPlan[${index}].contentRoot`)
    const normalized = path.posix.normalize(contentRoot.replace(/\\/g, '/'))
    if (!INSTALL_PLAN_TARGETS.has(target) || targets.has(target) || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
      throw new Error(`补丁 ${patchId} package.installPlan[${index}] 无效`)
    }
    targets.add(target)
    return { target, contentRoot: normalized }
  })
}

function validateServerDownloadUrl(value, patchId) {
  try {
    new URL(value)
  } catch {
    throw new Error(`补丁 ${patchId} package.downloadUrl 不是有效 URL`)
  }
  if (!isTrustedServerUrl(value)) {
    throw new Error(`补丁 ${patchId} package.downloadUrl 必须指向分发服务器`)
  }
  return value
}

function validatePackage(packageInfo, patchId) {
  if (!packageInfo || typeof packageInfo !== 'object') {
    throw new Error(`补丁 ${patchId} 缺少 package`)
  }

  const releaseTag = assertString(packageInfo.releaseTag, `补丁 ${patchId} package.releaseTag`)
  const assetName = assertString(packageInfo.assetName, `补丁 ${patchId} package.assetName`)
  if (assetName.includes('/') || assetName.includes('\\')) {
    throw new Error(`补丁 ${patchId} package.assetName 无效`)
  }
  const sha256 = assertString(packageInfo.sha256, `补丁 ${patchId} package.sha256`).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`补丁 ${patchId} 的 SHA-256 格式无效`)
  }
  const size = Number(packageInfo.size)
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error(`补丁 ${patchId} package.size 必须是大于 0 的整数`)
  }
  const downloadUrl = packageInfo.downloadUrl === undefined || packageInfo.downloadUrl === null || packageInfo.downloadUrl === ''
    ? ''
    : validateServerDownloadUrl(assertString(packageInfo.downloadUrl, `补丁 ${patchId} package.downloadUrl`), patchId)

  return {
    releaseTag,
    assetName,
    sha256,
    size,
    contentRoot: typeof packageInfo.contentRoot === 'string' ? packageInfo.contentRoot.trim() : '',
    downloadUrl,
    installPlan: validateInstallPlan(packageInfo, patchId)
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
    if (file.target === undefined) return { relativePath, sha256 }
    const target = assertString(file.target, `补丁 ${patchId} fingerprint[${index}].target`)
    if (!INSTALL_PLAN_TARGETS.has(target)) throw new Error(`补丁 ${patchId} fingerprint[${index}].target 无效`)
    return { target, relativePath, sha256 }
  })
}

const MULTI_SIM_SLOTS = new Set(['msfs2024', 'msfs2020'])

function validateDualSim(value, patchId) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`补丁 ${patchId} dualSim 必须是对象`)
  }
  const rawSlots = Array.isArray(value.slots) ? value.slots : []
  const slots = []
  const seen = new Set()
  for (const entry of rawSlots) {
    const slot = typeof entry?.slot === 'string' ? entry.slot.trim().toLowerCase() : ''
    if (!MULTI_SIM_SLOTS.has(slot) || seen.has(slot)) continue
    seen.add(slot)
    const normalized = { slot }
    const folder = typeof entry?.communityFolder === 'string' ? entry.communityFolder.trim() : ''
    if (folder) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(folder)) {
        throw new Error(`补丁 ${patchId} dualSim.slots[${slots.length}].communityFolder 格式无效`)
      }
      normalized.communityFolder = folder
    }
    slots.push(normalized)
  }
  // slots 为空表示客户端按默认双槽位处理
  return { slots }
}

function validateLogo(value, patchId) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`补丁 ${patchId} logo 必须是对象`)
  }
  const url = validateServerDownloadUrl(assertString(value.url, `补丁 ${patchId} logo.url`), patchId)
  const positions = new Set(['bottom-right', 'bottom-left', 'top-right', 'top-left'])
  const position = positions.has(value.position) ? value.position : 'bottom-right'
  return { url, position, lift: value.lift === true }
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
      // 展示标题：服务端下发的中文名优先，回退英文标识 name
      title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : null,
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
      // 下载量（服务端按 IP 24 小时去重累计）；旧缓存/旧服务端缺失时按 0 展示
      downloadCount: (() => {
        const count = Number(patch.downloadCount)
        return Number.isSafeInteger(count) && count > 0 ? count : 0
      })(),
      // 发布时间（ISO 字符串）：补丁卡片"按更新时间"排序依据；缺失时排序回退原顺序
      publishedAt: typeof patch.publishedAt === 'string' && patch.publishedAt.trim()
        ? patch.publishedAt.trim()
        : null,
      status,
      compatibility: Array.isArray(patch.compatibility)
        ? patch.compatibility.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
        : [],
      targetHint: typeof patch.targetHint === 'string' ? patch.targetHint.trim() : '请选择安装目录',
      targetFolders: Array.isArray(patch.targetFolders)
        ? [...new Set(patch.targetFolders.filter((folder) => typeof folder === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(folder.trim())).map((folder) => folder.trim()))]
        : [],
      targetKind: TARGET_KINDS.has(patch.targetKind) ? patch.targetKind : 'addon',
      dualSim: validateDualSim(patch.dualSim, id),
      logo: validateLogo(patch.logo, id),
      releaseNotes: Array.isArray(patch.releaseNotes)
        ? patch.releaseNotes.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
        : [],
      fingerprint: validateFingerprint(patch.fingerprint, id),
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

class ServerCatalog {
  constructor({ cacheDirectory, fetchImpl = globalThis.fetch, catalogUrl = CATALOG_URL, timeoutMs = CATALOG_TIMEOUT_MS, channelPublicKey } = {}) {
    this.cacheDirectory = cacheDirectory
    this.cachePath = path.join(cacheDirectory, 'patch-catalog.json')
    this.fetchImpl = fetchImpl
    this.catalogUrl = catalogUrl
    this.timeoutMs = timeoutMs
    // 渠道验签公钥：生产一律使用内嵌作者公钥（channel-signing 默认值），仅供测试注入
    this.channelPublicKey = channelPublicKey
    // 单飞锁：并发 refresh 共用同一次请求/写盘（第 1 轮攻击报告附带发现：
    // 并发写 patch-catalog.json.tmp 后 rename ENOENT）
    this.inFlightRefresh = null
  }

  async readCache() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.cachePath, 'utf8'))
      if (parsed && typeof parsed === 'object' && parsed.cacheSchema === 2 && parsed.payload) {
        // cacheSchema 2：缓存服务端原始响应载荷（验签必须对原始字节口径的对象进行，
        // validateCatalog 重建后的对象与签名对象不一致）；签名缺失过渡放行，验签失败拒绝
        const payload = parsed.payload
        const body = parsed.signature
          ? { ...payload, signatureAlgorithm: parsed.signatureAlgorithm, signature: parsed.signature }
          : payload
        const verdict = adjudicateChannelResponse({ kind: 'catalog', body, publicKey: this.channelPublicKey })
        if (!verdict.accept) return null
        return validateCatalog(verdict.payload)
      }
      // 旧版缓存：裸目录对象（无签名语义，向后兼容）。ENFORCE_REQUIRED 翻转后
      // 旧格式一律作废重取（返回 null → refresh 重新拉取带签名目录），而不是
      // 硬拒呈现或放行未验证数据（评审教训：避免升级用户目录空白）
      if (isEnforceRequired()) return null
      return validateCatalog(parsed)
    } catch {
      return null
    }
  }

  async writeCache(catalog, rawPayload, signature = null) {
    await fs.mkdir(this.cacheDirectory, { recursive: true })
    const temporaryPath = `${this.cachePath}.tmp`
    const envelope = {
      cacheSchema: 2,
      // rawPayload 缺省（旧调用方）时以规范化目录为载荷——此时签名应为 null，
      // 缓存按未签名口径回读
      payload: rawPayload ?? catalog,
      signatureAlgorithm: signature?.signatureAlgorithm ?? null,
      signature: signature?.signature ?? null
    }
    await fs.writeFile(temporaryPath, JSON.stringify(envelope, null, 2), 'utf8')
    await fs.rename(temporaryPath, this.cachePath)
  }

  async fetchCatalog(url) {
    const response = await this.fetchImpl(`${url}?t=${Date.now()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'msfs-cat-ch'
      },
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!response.ok) {
      throw new Error(`补丁目录服务器返回 HTTP ${response.status}`)
    }
    const body = await response.json()
    // 渠道验签：坏签名硬拒绝；未签名（服务端尚未部署）过渡期放行（fail-open 不退让）
    const verdict = adjudicateChannelResponse({ kind: 'catalog', body, publicKey: this.channelPublicKey })
    if (!verdict.accept) {
      throw new Error('补丁目录验签失败，已拒绝被篡改的数据')
    }
    return {
      catalog: validateCatalog(verdict.payload),
      rawPayload: verdict.payload,
      signature: verdict.verified ? { signatureAlgorithm: 'ed25519', signature: body.signature } : null
    }
  }

  // 2.0 起目录只来自分发服务器；服务器不可用时读取本地缓存（可能过期），无缓存则报错。
  async refresh() {
    if (this.inFlightRefresh) return this.inFlightRefresh
    this.inFlightRefresh = this.doRefresh().finally(() => { this.inFlightRefresh = null })
    return this.inFlightRefresh
  }

  async doRefresh() {
    try {
      const { catalog, rawPayload, signature } = await this.fetchCatalog(this.catalogUrl)
      await this.writeCache(catalog, rawPayload, signature)
      return { catalog, source: 'server', stale: false, error: null, signature: signature ? 'verified' : 'unsigned' }
    } catch (error) {
      const cached = await this.readCache()
      if (cached) {
        return { catalog: cached, source: 'cache', stale: true, error: error.message, signature: 'unknown' }
      }
      throw new Error(`无法从云端服务器读取补丁目录：${error.message}`)
    }
  }
}

module.exports = {
  CATALOG_MANIFEST_PATH,
  CATALOG_TIMEOUT_MS,
  CATALOG_URL,
  ServerCatalog,
  validateCatalog
}
