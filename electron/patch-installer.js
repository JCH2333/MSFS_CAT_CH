const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')
const extractZip = require('extract-zip')

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
])

function ensureSafeId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(value)) {
    throw new Error('补丁 ID 无效')
  }
  return value
}

function ensureWithin(root, candidate) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`检测到越界路径：${candidate}`)
  }
  return resolvedCandidate
}

function normalizeContentRoot(value) {
  if (!value) return ''
  const normalized = path.normalize(value)
  if (path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error('package.contentRoot 路径无效')
  }
  return normalized
}

function fingerprintFiles(patch) {
  return Array.isArray(patch?.fingerprint)
    ? patch.fingerprint.filter((file) => (
      file
      && typeof file.relativePath === 'string'
      && typeof file.sha256 === 'string'
      && /^[a-f0-9]{64}$/.test(file.sha256)
    ))
    : []
}

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function walkFiles(root) {
  const result = []
  async function visit(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      const stats = await fsp.lstat(fullPath)
      if (stats.isSymbolicLink()) {
        throw new Error(`补丁包包含不允许的符号链接：${entry.name}`)
      }
      if (stats.isDirectory()) {
        await visit(fullPath)
      } else if (stats.isFile()) {
        result.push(fullPath)
      }
    }
  }
  await visit(root)
  return result
}

function isAllowedDownloadUrl(input) {
  const url = new URL(input)
  return url.protocol === 'https:' && (
    ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)
    || url.hostname.endsWith('.githubusercontent.com')
  )
}

async function downloadToFile(url, destination, onProgress, redirectsRemaining = 6) {
  if (!isAllowedDownloadUrl(url)) {
    throw new Error('补丁下载地址不是受信任的 GitHub 地址')
  }

  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const temporaryPath = `${destination}.part`

  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'msfs-cat-ch' } }, (response) => {
      const status = response.statusCode || 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirectsRemaining <= 0) {
          reject(new Error('补丁下载重定向次数过多'))
          return
        }
        const nextUrl = new URL(response.headers.location, url).toString()
        downloadToFile(nextUrl, destination, onProgress, redirectsRemaining - 1).then(resolve, reject)
        return
      }
      if (status !== 200) {
        response.resume()
        reject(new Error(`补丁下载失败：HTTP ${status}`))
        return
      }

      const total = Number(response.headers['content-length'] || 0)
      let received = 0
      const output = fs.createWriteStream(temporaryPath)
      response.on('data', (chunk) => {
        received += chunk.length
        onProgress?.({ phase: 'download', received, total })
      })
      response.on('error', reject)
      output.on('error', reject)
      output.on('close', async () => {
        try {
          await fsp.rename(temporaryPath, destination)
          resolve(destination)
        } catch (error) {
          reject(error)
        }
      })
      response.pipe(output)
    })
    request.setTimeout(30000, () => request.destroy(new Error('补丁下载超时')))
    request.on('error', reject)
  }).catch(async (error) => {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  })
}

class PatchInstaller {
  constructor({ userDataDirectory, onProgress = () => {}, download = downloadToFile }) {
    this.userDataDirectory = userDataDirectory
    this.statePath = path.join(userDataDirectory, 'installations.json')
    this.backupRoot = path.join(userDataDirectory, 'backups')
    this.onProgress = onProgress
    this.download = download
  }

  async readState() {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.statePath, 'utf8'))
      return parsed && typeof parsed === 'object' && parsed.installations
        ? parsed
        : { schemaVersion: 1, installations: {} }
    } catch {
      return { schemaVersion: 1, installations: {} }
    }
  }

  async writeState(state) {
    await fsp.mkdir(this.userDataDirectory, { recursive: true })
    const temporaryPath = `${this.statePath}.tmp`
    await fsp.writeFile(temporaryPath, JSON.stringify(state, null, 2), 'utf8')
    await fsp.rename(temporaryPath, this.statePath)
  }

  async listInstallations() {
    return (await this.readState()).installations
  }

  async reconcileInstallations(patches, targetPaths) {
    const state = await this.readState()
    const result = {}
    let changed = false

    for (const patch of Array.isArray(patches) ? patches : []) {
      const patchId = ensureSafeId(patch?.id)
      if (state.installations[patchId]) continue
      const targetPath = targetPaths?.[patchId]
      const fingerprints = fingerprintFiles(patch)
      if (!targetPath || fingerprints.length === 0) continue

      const target = path.resolve(targetPath)
      const targetStats = await fsp.stat(target).catch(() => null)
      if (!targetStats?.isDirectory()) continue

      let matches = true
      for (const file of fingerprints) {
        try {
          const destination = ensureWithin(target, path.join(target, file.relativePath))
          const stats = await fsp.stat(destination).catch(() => null)
          if (!stats?.isFile() || await sha256(destination) !== file.sha256) {
            matches = false
            break
          }
        } catch {
          matches = false
          break
        }
      }

      if (!matches) continue
      const now = new Date().toISOString()
      state.installations[patchId] = {
        patchId,
        name: patch.name,
        version: patch.version,
        targetPath: target,
        installedAt: now,
        detectedAt: now,
        source: 'detected',
        backupDirectory: null,
        files: fingerprints.map((file) => ({
          relativePath: file.relativePath,
          hadOriginal: false,
          backupPath: null,
          installedHash: file.sha256
        }))
      }
      result[patchId] = 'recognized'
      changed = true
    }

    if (changed) await this.writeState(state)
    return result
  }

  async verifyInstallations() {
    const installations = await this.listInstallations()
    const result = {}

    for (const [patchId, installation] of Object.entries(installations)) {
      const missingFiles = []
      const modifiedFiles = []
      const files = Array.isArray(installation.files) ? installation.files : []

      for (const file of files) {
        try {
          const destination = ensureWithin(installation.targetPath, path.join(installation.targetPath, file.relativePath))
          const stats = await fsp.stat(destination).catch(() => null)
          if (!stats?.isFile()) {
            missingFiles.push(file.relativePath)
          } else if (await sha256(destination) !== file.installedHash) {
            modifiedFiles.push(file.relativePath)
          }
        } catch {
          missingFiles.push(file.relativePath)
        }
      }

      result[patchId] = {
        state: missingFiles.length > 0 ? 'missing' : modifiedFiles.length > 0 ? 'modified' : 'intact',
        checkedAt: new Date().toISOString(),
        checkedFiles: files.length,
        missingFiles,
        modifiedFiles
      }
    }

    return result
  }

  emit(patchId, payload) {
    this.onProgress({ patchId, ...payload })
  }

  async install(patch, targetPath) {
    const patchId = ensureSafeId(patch?.id)
    if (patch.status !== 'published' || !patch.package) {
      throw new Error('该补丁尚未发布')
    }
    if (typeof targetPath !== 'string' || !targetPath.trim()) {
      throw new Error('请选择安装目录')
    }

    const target = path.resolve(targetPath)
    const targetStats = await fsp.stat(target).catch(() => null)
    if (!targetStats?.isDirectory()) {
      throw new Error('安装目录不存在或不可访问')
    }

    const state = await this.readState()
    if (state.installations[patchId]) {
      if (state.installations[patchId].source === 'detected') {
        if (state.installations[patchId].version === patch.version) return state.installations[patchId]
        throw new Error('检测到历史手动安装，但没有原始文件备份，无法安全自动更新。请先恢复插件原版文件后再安装新补丁。')
      }
      const restoreResult = await this.restore(patchId)
      if (!restoreResult.restored) {
        throw new Error(`旧版本存在无法自动还原的文件：${restoreResult.conflicts.join('、')}`)
      }
    }

    const workingDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'gsx-chinese-'))
    const archivePath = path.join(workingDirectory, 'patch.zip')
    const extractDirectory = path.join(workingDirectory, 'content')
    const backupDirectory = path.join(this.backupRoot, patchId, String(Date.now()))
    const appliedFiles = []
    const preparedBackups = new Set()

    try {
      const fingerprints = fingerprintFiles(patch)
      if (fingerprints.length > 0) {
        await fsp.mkdir(backupDirectory, { recursive: true })
        for (const file of fingerprints) {
          const destination = ensureWithin(target, path.join(target, file.relativePath))
          const existingStats = await fsp.stat(destination).catch(() => null)
          if (!existingStats?.isFile()) continue
          const backupPath = ensureWithin(backupDirectory, path.join(backupDirectory, file.relativePath))
          await fsp.mkdir(path.dirname(backupPath), { recursive: true })
          await fsp.copyFile(destination, backupPath)
          preparedBackups.add(file.relativePath)
        }
      }
      this.emit(patchId, { phase: 'download', percent: 0, message: '正在下载补丁' })
      await this.download(patch.package.downloadUrl, archivePath, ({ received, total }) => {
        const percent = total > 0 ? Math.min(55, Math.round((received / total) * 55)) : 0
        this.emit(patchId, { phase: 'download', percent, received, total, message: '正在下载补丁' })
      })

      this.emit(patchId, { phase: 'verify', percent: 58, message: '正在校验补丁' })
      const actualHash = await sha256(archivePath)
      if (actualHash !== patch.package.sha256) {
        throw new Error('补丁 SHA-256 校验失败，文件可能不完整')
      }

      await fsp.mkdir(extractDirectory, { recursive: true })
      this.emit(patchId, { phase: 'extract', percent: 64, message: '正在解压补丁' })
      await extractZip(archivePath, { dir: extractDirectory })
      const contentRoot = ensureWithin(extractDirectory, path.join(extractDirectory, normalizeContentRoot(patch.package.contentRoot)))
      const contentStats = await fsp.stat(contentRoot).catch(() => null)
      if (!contentStats?.isDirectory()) {
        throw new Error('补丁包 contentRoot 不存在')
      }

      const sourceFiles = await walkFiles(contentRoot)
      if (sourceFiles.length === 0) {
        throw new Error('补丁包中没有可安装文件')
      }

      await fsp.mkdir(backupDirectory, { recursive: true })
      const recordFiles = []
      for (let index = 0; index < sourceFiles.length; index += 1) {
        const sourceFile = sourceFiles[index]
        const relativePath = path.relative(contentRoot, sourceFile)
        if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
          throw new Error(`补丁文件路径无效：${relativePath}`)
        }
        const destination = ensureWithin(target, path.join(target, relativePath))
        const backupPath = ensureWithin(backupDirectory, path.join(backupDirectory, relativePath))
        const existingStats = await fsp.stat(destination).catch(() => null)
        if (existingStats?.isDirectory()) {
          throw new Error(`目标位置是目录，无法写入文件：${relativePath}`)
        }

        const hadOriginal = Boolean(existingStats?.isFile())
        if (hadOriginal && !preparedBackups.has(relativePath)) {
          await fsp.mkdir(path.dirname(backupPath), { recursive: true })
          await fsp.copyFile(destination, backupPath)
        }

        await fsp.mkdir(path.dirname(destination), { recursive: true })
        await fsp.copyFile(sourceFile, destination)
        const installedHash = await sha256(destination)
        const fileRecord = { relativePath, hadOriginal, backupPath: hadOriginal ? backupPath : null, installedHash }
        recordFiles.push(fileRecord)
        appliedFiles.push({ destination, ...fileRecord })

        const percent = 68 + Math.round(((index + 1) / sourceFiles.length) * 30)
        this.emit(patchId, { phase: 'install', percent, message: `正在安装 ${index + 1}/${sourceFiles.length}` })
      }

      const installation = {
        patchId,
        name: patch.name,
        version: patch.version,
        targetPath: target,
        installedAt: new Date().toISOString(),
        source: 'managed',
        backupDirectory,
        files: recordFiles
      }
      const latestState = await this.readState()
      latestState.installations[patchId] = installation
      await this.writeState(latestState)
      this.emit(patchId, { phase: 'complete', percent: 100, message: '安装完成' })
      return installation
    } catch (error) {
      for (const file of appliedFiles.reverse()) {
        try {
          if (file.hadOriginal && file.backupPath) {
            await fsp.copyFile(file.backupPath, file.destination)
          } else {
            await fsp.rm(file.destination, { force: true })
          }
        } catch {
          // Preserve the original error; remaining backups stay on disk for manual recovery.
        }
      }
      this.emit(patchId, { phase: 'error', percent: 0, message: error.message })
      throw error
    } finally {
      await fsp.rm(workingDirectory, { recursive: true, force: true }).catch(() => {})
    }
  }

  async restore(patchIdInput) {
    const patchId = ensureSafeId(patchIdInput)
    const state = await this.readState()
    const installation = state.installations[patchId]
    if (!installation) {
      return { restored: true, conflicts: [], filesRestored: 0 }
    }

    if (installation.source === 'detected') {
      return {
        restored: false,
        conflicts: installation.files.map((file) => file.relativePath),
        filesRestored: 0,
        reason: 'detected-installation-without-original-backup'
      }
    }

    const conflicts = []
    let filesRestored = 0
    for (const file of [...installation.files].reverse()) {
      const destination = ensureWithin(installation.targetPath, path.join(installation.targetPath, file.relativePath))
      if (file.hadOriginal) {
        const backupStats = await fsp.stat(file.backupPath).catch(() => null)
        if (!backupStats?.isFile()) {
          conflicts.push(file.relativePath)
          continue
        }
        await fsp.mkdir(path.dirname(destination), { recursive: true })
        await fsp.copyFile(file.backupPath, destination)
        filesRestored += 1
        continue
      }

      const currentStats = await fsp.stat(destination).catch(() => null)
      if (!currentStats) continue
      if (!currentStats.isFile() || await sha256(destination) !== file.installedHash) {
        conflicts.push(file.relativePath)
        continue
      }
      await fsp.rm(destination, { force: true })
      filesRestored += 1
    }

    if (conflicts.length === 0) {
      delete state.installations[patchId]
      await this.writeState(state)
      await fsp.rm(installation.backupDirectory, { recursive: true, force: true }).catch(() => {})
    }

    return { restored: conflicts.length === 0, conflicts, filesRestored }
  }
}

module.exports = {
  PatchInstaller,
  ensureWithin,
  isAllowedDownloadUrl,
  normalizeContentRoot,
  sha256
}
