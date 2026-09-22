#!/usr/bin/env node
// GSX 镜像自动种子器（开发机，计划任务每 15 分钟运行一次）
//
// 职责：检测官方 GitHub Release 资产 digest 与服务器镜像 sha256 的漂移，
// 有漂移即自动运行 seed.mjs 同步，并经服务器 gsx-watch 的 SMTP 发结果邮件：
//   - 同步成功：官方版本、变更组件、提醒管理员跑汉化补丁适配流程
//   - 同步失败：原因 + 需要人工介入（同一失败 6 小时内不重复发）
//   - 持续无法检测（连续 8 次 ≈ 2 小时，多为代理掉线）：告警一次
// 凭据：读取 .local-lab/gsx-autoseed-credentials.json（gitignored，不入仓库）。
// 路径：全部基于脚本自身位置解析，不依赖工作目录（计划任务无工作目录概念）。

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TOOL_DIR, '..', '..')
const LAB_DIR = path.join(REPO_ROOT, '.local-lab')
const CREDENTIALS_FILE = path.join(LAB_DIR, 'gsx-autoseed-credentials.json')
const STATE_FILE = path.join(LAB_DIR, 'gsx-autoseed-state.json')
const LOG_FILE = path.join(LAB_DIR, 'gsx-autoseed.log')

const SERVER_ORIGIN = (process.env.GSX_ADMIN_ORIGIN || 'http://47.109.31.236:20075').replace(/\/$/, '')
const RELEASE_API = 'https://api.github.com/repos/virtualisoftware/fsdt-offline-installer/releases/latest'
const SSH_TARGET = process.env.GSX_SSH_TARGET || 'admin@47.109.31.236'
const WATCH_MAIL_BIN = '~/gsx-watch/bin/send_mail.py'

const GITHUB_FAIL_ALERT_THRESHOLD = 8 // 连续失败次数阈值（15 分钟一次 ≈ 2 小时）
const FAILURE_REMAIL_HOURS = 6

function now() {
  return new Date().toISOString()
}

function log(message) {
  const line = `[${now()}] ${message}`
  console.log(line)
  try {
    fs.appendFileSync(LOG_FILE, line + '\n')
    const size = fs.statSync(LOG_FILE).size
    if (size > 2 * 1024 * 1024) fs.writeFileSync(LOG_FILE, line + '\n') // 超限整体重置（保留尾行足够排查）
  } catch { /* 日志失败不影响主流程 */ }
}

async function fetchJson(url, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'msfs-cat-ch-autoseed', Accept: 'application/vnd.github+json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function normalizeDigest(value) {
  return String(value || '').trim().replace(/^sha256:/i, '').toLowerCase()
}

/** 官方资产：组件名 → { digest, volumes } */
async function fetchOfficialAssets() {
  const release = await fetchJson(RELEASE_API)
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

async function fetchServerDigests() {
  const manifest = await fetchJson(`${SERVER_ORIGIN}/api/gsx/manifest.json`, 15000)
  const map = new Map()
  for (const pkg of manifest.packages || []) {
    map.set(pkg.component, normalizeDigest(pkg.sha256))
  }
  return map
}

function loadCredentials() {
  if (process.env.GSX_ADMIN_TOKEN) return { token: process.env.GSX_ADMIN_TOKEN }
  if (process.env.GSX_ADMIN_USERNAME && process.env.GSX_ADMIN_PASSWORD) {
    return { username: process.env.GSX_ADMIN_USERNAME, password: process.env.GSX_ADMIN_PASSWORD }
  }
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'))
  if (!raw.username || !raw.password) throw new Error('凭据文件缺少 username/password')
  return raw
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveState(state) {
  fsp.mkdir(LAB_DIR, { recursive: true })
    .then(() => fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n'))
    .catch(() => {})
}

function sh(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout || '', stderr: stderr || '', error })
    })
  })
}

/** 经服务器 gsx-watch 的 SMTP 发邮件（正文经 scp 上传，避免 ssh 参数中文转码问题） */
async function sendMail(subject, body) {
  await fsp.mkdir(LAB_DIR, { recursive: true })
  const localBody = path.join(LAB_DIR, `gsx-autoseed-mail-${Date.now()}.txt`)
  await fsp.writeFile(localBody, body, 'utf8')
  const remoteBody = `/tmp/${path.basename(localBody)}`
  const up = await sh('scp', ['-q', localBody, `${SSH_TARGET}:${remoteBody}`])
  if (!up.ok) throw new Error(`邮件正文上传失败：${up.stderr.slice(0, 200)}`)
  const send = await sh('ssh', [SSH_TARGET,
    `python3 ${WATCH_MAIL_BIN} "${subject.replace(/"/g, '')}" ${remoteBody} && rm -f ${remoteBody}`])
  await fsp.rm(localBody, { force: true })
  if (!send.ok) throw new Error(`邮件发送失败：${(send.stderr || send.stdout).slice(0, 300)}`)
  log(`邮件已发送：${subject}`)
}

function digestSetHash(components) {
  return createHash('sha256').update(components.map((c) => `${c.name}:${c.official}`).join('|')).digest('hex')
}

async function main() {
  let credentials
  try {
    credentials = loadCredentials()
  } catch (error) {
    log(`凭据不可用：${error.message}（自动退出，不发告警）`)
    process.exit(1)
  }

  let official
  try {
    official = await fetchOfficialAssets()
  } catch (error) {
    const state = loadState()
    state.githubFailures = (state.githubFailures || 0) + 1
    saveState(state)
    log(`官方 release 获取失败（连续第 ${state.githubFailures} 次）：${error.message}`)
    if (state.githubFailures === GITHUB_FAIL_ALERT_THRESHOLD) {
      try {
        await sendMail('[GSX 自动同步] 官方更新检测持续失败',
          `连续 ${state.githubFailures} 次（约 2 小时）无法读取 GitHub 官方 release，\n` +
          '镜像自动同步已停摆。最常见原因：开发机代理（127.0.0.1:7897）未运行。\n' +
          `恢复检测后本告警不会重发；时间：${now()}\n`)
      } catch (mailError) {
        log(`告警邮件失败：${mailError.message}`)
      }
    }
    return
  }
  const state = loadState()
  if (state.githubFailures) {
    state.githubFailures = 0
    saveState(state)
  }

  let serverDigests
  try {
    serverDigests = await fetchServerDigests()
  } catch (error) {
    log(`服务器清单获取失败：${error.message}（下轮重试）`)
    return
  }

  const MIRRORED = [
    'GSX', 'GSX_sounds', 'couatl', 'couatl64', 'couatl64_wx', 'couatl_wx',
    'fsdreamteam-gsx-pro-textures', 'fsdreamteam-gsx-world-of-jetways-textures'
  ]
  const driftComponents = []
  let needsSeedRun = false
  for (const name of MIRRORED) {
    const asset = official.assets.get(name)
    if (!asset || !asset.digest || asset.volumes !== 1) {
      // 官方缺资产或多分卷：digest 比对不可用，交给 seed 的 etag 兜底判定
      needsSeedRun = true
      continue
    }
    if (serverDigests.get(name) !== asset.digest) {
      driftComponents.push({ name, official: asset.digest })
    }
  }

  if (driftComponents.length === 0 && !needsSeedRun) {
    log(`无漂移（官方 ${official.tag}，镜像一致）`)
    if (state.lastFailKey) {
      delete state.lastFailKey
      saveState(state)
    }
    return
  }

  const changedNames = driftComponents.map((c) => c.name).join(', ') || '(多分卷/缺资产，交由 seed 判定)'
  log(`检测到漂移（官方 ${official.tag}）：${changedNames}，运行 seed…`)
  const seedEnv = {
    ...process.env,
    GSX_ADMIN_ORIGIN: SERVER_ORIGIN
  }
  if (credentials.token) seedEnv.GSX_ADMIN_TOKEN = credentials.token
  if (credentials.username) seedEnv.GSX_ADMIN_USERNAME = credentials.username
  if (credentials.password) seedEnv.GSX_ADMIN_PASSWORD = credentials.password

  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(TOOL_DIR, 'seed.mjs')], {
      env: seedEnv,
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
      process.stderr.write(chunk)
    })
    child.on('close', (code) => resolve({ code, output }))
  })

  const resultLine = (result.output.match(/^.*RESULT: .*$/m) || [''])[0].replace('[gsx-seed] ', '')
  const failKey = createHash('sha256')
    .update(`${official.tag}|${changedNames}|${result.code}|${result.output.slice(-500)}`)
    .digest('hex')

  if (result.code === 0) {
    // 同步后复核：服务器清单应与官方一致
    let verifyNames = changedNames
    try {
      const after = await fetchServerDigests()
      const stillDrifted = MIRRORED.filter((name) => {
        const asset = official.assets.get(name)
        return asset?.digest && asset.volumes === 1 && after.get(name) !== asset.digest
      })
      verifyNames = stillDrifted.length === 0 ? '全部一致 ✓' : `仍未同步：${stillDrifted.join(', ')}`
    } catch { /* 复核失败不改变同步成功的结论 */ }
    const stateAfter = loadState()
    delete stateAfter.lastFailKey
    saveState(stateAfter)
    log(`同步完成（exit=0）：${resultLine || '成功'}`)
    try {
      await sendMail('[GSX 自动同步] 官方更新已镜像，请跑补丁适配流程',
        `官方 release ${official.tag} 的更新已自动同步到分发服务器。\n\n` +
        `变更组件：${changedNames}\n` +
        `seed 结果：${resultLine || '成功'}\n` +
        `同步复核：${verifyNames}\n` +
        `时间：${now()}\n\n` +
        '提醒：GSX 更新会覆盖汉化补丁文件（FSDT_GSX_Panel.* 在 pro-textures 包内），\n' +
        '客户端会提示受影响用户重装补丁；请按补丁适配流程实机验证汉化是否完好，\n' +
        '若面板结构变化则适配并发补丁新版本。\n')
    } catch (mailError) {
      log(`成功邮件发送失败（同步本身已完成）：${mailError.message}`)
    }
  } else {
    const lastState = loadState()
    const remail = lastState.lastFailKey !== failKey
      || !lastState.lastFailAt
      || Date.now() - lastState.lastFailAt > FAILURE_REMAIL_HOURS * 3600 * 1000
    lastState.lastFailKey = failKey
    lastState.lastFailAt = Date.now()
    saveState(lastState)
    log(`seed 失败（exit=${result.code}）${remail ? '，发送告警' : '，同一失败 6 小时内不重复告警'}`)
    if (remail) {
      try {
        await sendMail('[GSX 自动同步] 同步失败，需要人工介入',
          `自动镜像同步失败，请人工运行 tools/gsx-mirror/seed.mjs 排查。\n\n` +
          `官方 release：${official.tag}\n变更组件：${changedNames}\n` +
          `seed 输出（尾部）：\n${result.output.slice(-1200)}\n时间：${now()}\n`)
      } catch (mailError) {
        log(`失败告警邮件发送失败：${mailError.message}`)
      }
    }
    process.exitCode = 1
  }
}

main().catch((error) => {
  log(`自动种子器异常退出：${error.stack || error.message}`)
  process.exit(1)
})
