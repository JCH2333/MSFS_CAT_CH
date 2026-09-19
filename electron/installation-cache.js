const fs = require('node:fs/promises')
const path = require('node:path')

// 安装目标缓存：把目录探测（UserCfg.opt 解析 + 注册表全树枚举 + 逐目录存在性
// 探测）的结果持久化到 userData，启动时签名一致且目录仍存在就直接复用，
// 不再全盘扫描（语音包机器上的注册表枚举可达数秒，是启动安装状态链的大头）。

const CACHE_SCHEMA_VERSION = 1

// 目录检测只依赖描述符的这几个字段；签名覆盖它们，目录新增/目标变化自动失效缓存
function descriptorKey(patch) {
  return {
    id: typeof patch?.id === 'string' ? patch.id : '',
    targetKind: typeof patch?.targetKind === 'string' ? patch.targetKind : '',
    targetFolders: Array.isArray(patch?.targetFolders)
      ? patch.targetFolders.filter((folder) => typeof folder === 'string')
      : [],
    dualSim: patch?.dualSim && typeof patch.dualSim === 'object' ? patch.dualSim : null
  }
}

function computeDescriptorSignature(patches) {
  return JSON.stringify((Array.isArray(patches) ? patches : []).map(descriptorKey))
}

function normalizeCachedEntry(value) {
  if (!value || typeof value !== 'object') return null
  const targetPath = typeof value.targetPath === 'string' ? value.targetPath.trim() : ''
  if (!targetPath) return null
  const entry = { targetPath, source: typeof value.source === 'string' ? value.source : '' }
  if (Array.isArray(value.slots)) {
    const slots = value.slots
      .map((slot) => ({
        slot: typeof slot?.slot === 'string' ? slot.slot : '',
        targetPath: typeof slot?.targetPath === 'string' ? slot.targetPath.trim() : ''
      }))
      .filter((slot) => slot.slot && slot.targetPath)
    if (slots.length) entry.slots = slots
  }
  return entry
}

function normalizeCachedTargets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const targets = {}
  for (const [id, entry] of Object.entries(value)) {
    const normalized = normalizeCachedEntry(entry)
    if (normalized) targets[id] = normalized
  }
  return targets
}

// 返回缓存目标中已不存在的目录（含多模拟器槽位）；空数组表示缓存仍可用
async function findMissingTargetPaths(targets, isDirectoryImpl) {
  const isDirectory = isDirectoryImpl || (async (candidate) => {
    try {
      return (await fs.stat(candidate)).isDirectory()
    } catch {
      return false
    }
  })
  const missing = []
  for (const entry of Object.values(targets || {})) {
    if (!(await isDirectory(entry.targetPath))) missing.push(entry.targetPath)
    for (const slot of entry.slots || []) {
      if (!(await isDirectory(slot.targetPath))) missing.push(slot.targetPath)
    }
  }
  return [...new Set(missing)]
}

class InstallationTargetCache {
  constructor({ filePath }) {
    this.filePath = filePath
  }

  async read() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'))
      if (parsed?.schemaVersion !== CACHE_SCHEMA_VERSION || typeof parsed?.signature !== 'string') return null
      return {
        signature: parsed.signature,
        targets: normalizeCachedTargets(parsed.targets),
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null
      }
    } catch {
      return null
    }
  }

  async write(signature, targets) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify({
      schemaVersion: CACHE_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      signature,
      targets
    }), 'utf8')
    await fs.rename(temporaryPath, this.filePath)
  }
}

// 启动期目标解析：签名匹配且目录仍存在 → 直接复用缓存；否则全量探测并回写缓存。
// detect(patches) 返回补丁目录形态 { patchId: {targetPath, source, slots?} | 无 }。
async function resolveDetectedTargets({ patches, force = false, cache, detect, isDirectory }) {
  const signature = computeDescriptorSignature(patches)
  if (!force && cache) {
    const cached = await cache.read()
    if (cached && cached.signature === signature
      && (await findMissingTargetPaths(cached.targets, isDirectory)).length === 0) {
      return { targets: cached.targets, fromCache: true }
    }
  }
  const targets = normalizeCachedTargets(await detect(patches))
  if (cache) await cache.write(signature, targets).catch(() => {})
  return { targets, fromCache: false }
}

// 安装成功后把实际目标写入缓存：让"缓存未命中（还没装 GSX）→ 用户装好 GSX →
// 安装补丁"的机器下次启动同样命中缓存，而不是永远回退全盘扫描
async function recordInstalledTarget({ patchId, targetPath, slots = null, cache, source = '已安装补丁' }) {
  if (!cache || typeof patchId !== 'string' || !patchId) return false
  const primary = typeof targetPath === 'string' ? targetPath.trim() : ''
  if (!primary) return false
  const cached = await cache.read()
  if (!cached) return false
  cached.targets[patchId] = normalizeCachedEntry({
    targetPath: primary,
    source,
    slots: Array.isArray(slots) ? slots : null
  })
  await cache.write(cached.signature, cached.targets).catch(() => {})
  return true
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  InstallationTargetCache,
  computeDescriptorSignature,
  descriptorKey,
  findMissingTargetPaths,
  normalizeCachedEntry,
  normalizeCachedTargets,
  recordInstalledTarget,
  resolveDetectedTargets
}
