#!/usr/bin/env node
// GSX 官方更新镜像种子脚本
//
// 作用：把 FSDreamTeam 官方 GitHub Release（virtualisoftware/fsdt-offline-installer）
// 中发生变化的更新 ZIP 镜像到自建分发服务器，供客户端国内下载。
// 镜像红线：逐字节下载官方资产，绝不重打包；服务器端独立计算 SHA-256。
//
// 用法：
//   NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 \
//   GSX_ADMIN_TOKEN=<管理端JWT> 或 GSX_ADMIN_USERNAME=JCH2333 GSX_ADMIN_PASSWORD=*** \
//   node tools/gsx-mirror/seed.mjs [--dry-run] [--force] [--version 4.0.23]
//
// - 变更检测统一用 GitHub API 资产 digest 与服务器已发布 sha256 比对
//   （一次 API 调用即得全部资产 digest，不依赖资产 CDN 的 HEAD）；
//   仅当组件存在多分卷（.zip.002+）时回退 HEAD ETag 比对
// - 官方分卷 .zip.001/.002… 自动拼接为单个 zip
// - 含内嵌 manifest.json 的社区包自动读取 package_version 作为版本号
// - couatl 侧组件无版本信息，需 --version 传入（或沿用服务器已有版本）
// - 官方 update.lock 存在时中止（尊重官方熔断开关）
//
// 仅使用 Node 内置模块；代理依赖 Node >= 24 的 NODE_USE_ENV_PROXY=1。

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const COMPONENTS = [
  { name: 'GSX', target: 'couatl/GSX' },
  { name: 'GSX_sounds', target: 'couatl/GSX/sounds' },
  { name: 'couatl', target: 'couatl' },
  { name: 'couatl64', target: 'couatl64' },
  { name: 'couatl64_wx', target: 'couatl64/wx' },
  { name: 'couatl_wx', target: 'couatl/wx' },
  { name: 'fsdreamteam-gsx-pro-textures', target: 'MSFS/fsdreamteam-gsx-pro' },
  { name: 'fsdreamteam-gsx-world-of-jetways-textures', target: 'MSFS/fsdreamteam-gsx-world-of-jetways' }
]

const RELEASE_API = 'https://api.github.com/repos/virtualisoftware/fsdt-offline-installer/releases/latest'
const DOWNLOAD_BASE = 'https://github.com/virtualisoftware/fsdt-offline-installer/releases/latest/download'
const UPDATE_LOCK_URL = 'http://update.virtualisoftware.com/update.lock'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const FORCE = args.includes('--force')
const versionArgIndex = args.indexOf('--version')
const CLI_VERSION = versionArgIndex >= 0 ? args[versionArgIndex + 1] : null

const SERVER_ORIGIN = (process.env.GSX_ADMIN_ORIGIN || 'http://47.109.31.236:20075').replace(/\/$/, '')
const ADMIN_TOKEN = process.env.GSX_ADMIN_TOKEN
const ADMIN_USERNAME = process.env.GSX_ADMIN_USERNAME
const ADMIN_PASSWORD = process.env.GSX_ADMIN_PASSWORD
const WORKDIR = process.env.GSX_WORKDIR || path.join(process.cwd(), '.local-lab', 'gsx-seed-cache')

function log(message) {
  console.log(`[gsx-seed] ${message}`)
}

function normalizeEtag(value) {
  return String(value || '').trim().replace(/^"|"$/g, '')
}

function normalizeDigest(value) {
  return String(value || '').trim().replace(/^sha256:/i, '').toLowerCase()
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function checkUpdateLock() {
  try {
    const response = await fetchWithTimeout(UPDATE_LOCK_URL, { method: 'GET' }, 5000)
    if (response.status === 200) {
      const body = await response.text().catch(() => '')
      throw new Error(`官方 update.lock 生效，FSDT 已暂停更新通道：${body.slice(0, 200)}`)
    }
    log('update.lock 检查：未生效')
  } catch (error) {
    if (error.message.includes('update.lock')) throw error
    log('update.lock 探测不可达（视为未锁定，与官方口径一致）')
  }
}

/** 一次 API 调用取全部资产：组件名 → { digest（纯 hex）, volumes（分卷数） } */
async function fetchRelease() {
  const response = await fetchWithTimeout(RELEASE_API, {
    headers: { 'User-Agent': 'msfs-cat-ch-seed', Accept: 'application/vnd.github+json' }
  }, 30000)
  if (!response.ok) throw new Error(`GitHub API 请求失败：HTTP ${response.status}`)
  const release = await response.json()
  const assets = new Map()
  for (const asset of release.assets || []) {
    const match = /^(.+)\.zip\.(\d{3})$/.exec(asset.name || '')
    if (!match) continue
    const name = match[1]
    const entry = assets.get(name) || { digest: null, volumes: 0 }
    entry.volumes = Math.max(entry.volumes, Number(match[2]))
    if (asset.digest) entry.digest = normalizeDigest(asset.digest)
    assets.set(name, entry)
  }
  return { tag: release.tag_name, assets }
}

async function fetchRemoteEtag(component) {
  const response = await fetchWithTimeout(`${DOWNLOAD_BASE}/${component}.zip.001`, {
    method: 'HEAD',
    headers: { 'User-Agent': 'msfs-cat-ch-seed' }
  }, 30000)
  if (!response.ok) throw new Error(`HEAD ${component}.zip.001 失败：HTTP ${response.status}`)
  return normalizeEtag(response.headers.get('etag'))
}

async function adminToken() {
  if (ADMIN_TOKEN) return ADMIN_TOKEN
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error('缺少 GSX_ADMIN_TOKEN 或 GSX_ADMIN_USERNAME / GSX_ADMIN_PASSWORD 环境变量')
  }
  const response = await fetchWithTimeout(`${SERVER_ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
  }, 20000)
  const body = await response.json()
  const token = body?.data?.accessToken
  if (!response.ok || !token) throw new Error(`管理员登录失败：${body?.message || response.status}`)
  return token
}

async function downloadComponent(component) {
  await fs.mkdir(WORKDIR, { recursive: true })
  const destination = path.join(WORKDIR, `${component}.zip`)
  const partFile = `${destination}.part`
  const hash = createHash('sha256')
  const out = createWriteStream(partFile)
  let volume = 1
  let totalBytes = 0
  for (;;) {
    const suffix = volume === 1 ? '.zip.001' : `.zip.${String(volume).padStart(3, '0')}`
    const url = `${DOWNLOAD_BASE}/${component}${suffix}`
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'msfs-cat-ch-seed' }
    }, 120000)
    if (response.status === 404 && volume > 1) break
    if (!response.ok) throw new Error(`下载 ${component}${suffix} 失败：HTTP ${response.status}`)
    for await (const chunk of response.body) {
      hash.update(chunk)
      totalBytes += chunk.length
      if (!out.write(chunk)) {
        await new Promise((resolve) => out.once('drain', resolve))
      }
    }
    log(`  已下载分卷 ${path.basename(url)}（累计 ${(totalBytes / 1048576).toFixed(1)} MB）`)
    volume += 1
    if (volume > 50) throw new Error(`${component} 分卷数量异常（>50），中止`)
  }
  await new Promise((resolve, reject) => {
    out.end((error) => (error ? reject(error) : resolve()))
  })
  await fs.rename(partFile, destination)
  return { filePath: destination, sha256: hash.digest('hex'), size: totalBytes }
}

async function readEmbeddedVersion(filePath) {
  // 社区包 zip 的 manifest.json 位于打包头部，扫描文件头 512KB 提取 package_version；
  // couatl 侧组件不含 manifest.json，返回 null。
  const handle = await fs.open(filePath, 'r')
  try {
    const length = Math.min(512 * 1024, (await handle.stat()).size)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    const match = buffer.toString('latin1').match(/"package_version"\s*:\s*"([0-9.]+)"/)
    return match ? match[1] : null
  } finally {
    await handle.close()
  }
}

async function uploadAndPublish(token, component, target, version, downloaded) {
  const fileBuffer = await fs.readFile(downloaded.filePath)
  const form = new FormData()
  form.append('file', new Blob([fileBuffer]), `${component}.zip`)
  form.append('component', component)
  form.append('version', version)
  form.append('etag', downloaded.etag)
  form.append('deployTarget', target)
  form.append('assetName', `${component}.zip`)
  const response = await fetchWithTimeout(`${SERVER_ORIGIN}/api/admin/gsx/packages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  }, 300000)
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.code !== 200) {
    throw new Error(`上传失败：HTTP ${response.status} ${body?.message || ''}`)
  }
  const packageId = body.data?.id
  log(`  上传成功 id=${packageId} sha256=${downloaded.sha256.slice(0, 12)}…，发布中…`)
  const publishResponse = await fetchWithTimeout(`${SERVER_ORIGIN}/api/admin/gsx/packages/${packageId}/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  }, 60000)
  const publishBody = await publishResponse.json().catch(() => null)
  if (!publishResponse.ok || publishBody?.code !== 200) {
    throw new Error(`发布失败：HTTP ${publishResponse.status} ${publishBody?.message || ''}`)
  }
}

async function main() {
  log(`服务器：${SERVER_ORIGIN}${DRY_RUN ? '（dry-run，不做任何变更）' : ''}`)
  await checkUpdateLock()

  const { tag, assets } = await fetchRelease()
  log(`官方 latest release：${tag}（${assets.size} 个分卷组件）`)

  const manifestResponse = await fetchWithTimeout(`${SERVER_ORIGIN}/api/gsx/manifest.json`, {}, 15000)
  const serverManifest = manifestResponse.ok ? await manifestResponse.json() : { packages: [] }
  const publishedByComponent = new Map()
  for (const pkg of serverManifest.packages || []) {
    publishedByComponent.set(pkg.component, pkg)
  }

  let pendingChanges = 0
  const changedComponents = []
  for (const component of COMPONENTS) {
    const official = assets.get(component.name)
    if (!official || !official.digest) {
      log(`${component.name}：官方 release 缺少资产，跳过`)
      continue
    }
    const published = publishedByComponent.get(component.name)
    let drifted
    let driftBasis
    if (official.volumes === 1 && published?.sha256) {
      // 主路径：API digest vs 服务器 sha256（同一份字节，单分卷时恒等）
      drifted = normalizeDigest(published.sha256) !== official.digest
      driftBasis = `digest ${official.digest.slice(0, 12)}…`
    } else {
      // 多分卷或服务器无 sha256：回退 HEAD ETag 比对
      const remoteEtag = await fetchRemoteEtag(component.name)
      drifted = !(published && normalizeEtag(published.etag) === remoteEtag)
      driftBasis = `etag ${remoteEtag.slice(0, 12)}…`
    }
    if (!drifted && !FORCE) {
      log(`${component.name}：无变化（${driftBasis}）`)
      continue
    }
    pendingChanges += 1
    changedComponents.push(component.name)
    const version = CLI_VERSION
      || (published && published.version)
      || null
    if (DRY_RUN) {
      log(`${component.name}：需要更新 → ${driftBasis}，版本 ${version || '（需 --version 或上传时探测）'}`)
      continue
    }
    log(`${component.name}：下载官方分卷…`)
    const downloaded = await downloadComponent(component.name)
    downloaded.etag = await fetchRemoteEtag(component.name)
    const embedded = await readEmbeddedVersion(downloaded.filePath)
    const finalVersion = embedded || version
    if (!finalVersion) {
      throw new Error(`${component.name} 无法确定版本：组件内无 manifest.json，请用 --version 指定`)
    }
    log(`${component.name}：sha256=${downloaded.sha256}，版本 ${finalVersion}，上传中…`)
    const token = await adminToken()
    await uploadAndPublish(token, component.name, component.target, finalVersion, downloaded)
  }

  if (pendingChanges === 0) {
    log('RESULT: 镜像已与官方一致，无需更新。')
  } else if (DRY_RUN) {
    log(`RESULT: dry-run，共 ${pendingChanges} 个组件待镜像：${changedComponents.join(', ')}`)
  } else {
    log(`RESULT: 完成，${pendingChanges} 个组件已镜像并发布：${changedComponents.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(`[gsx-seed] 失败：${error.message}`)
  process.exit(1)
})
