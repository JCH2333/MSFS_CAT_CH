#!/usr/bin/env node
// 构建工具：把两份协议全文加密成 AES-256-GCM 密文，供客户端打包（密文打包方案）。
//
// 用法：
//   node tools/encrypt-agreements.mjs                 # 生成随机 32 字节密钥
//   node tools/encrypt-agreements.mjs --key <base64>  # 复用已有密钥（32 字节，base64）
//
// 行为：
// 1. 读取 tools/agreements-texts.mjs 的两份全文，按 legal-evidence 存证口径
//    （[用户协议, 免责声明] 单换行拼接、UTF-8）计算 SHA-256，必须等于
//    PINNED_AGREEMENT_TEXT_SHA256，否则立即报错退出（防止口径漂移）；
// 2. 用 AES-256-GCM 加密 JSON 明文 [{id:'user',body},{id:'notice',body}]，
//    auth tag（128 bit）拼在密文尾部；
// 3. 用开发机 .local-keys/agreements-signing.json 的 ed25519 私钥对
//    `legal-agreement-v1:<revision>:<sha256>` 签名；该私钥绝不入库，
//    客户端用 electron/agreements-secure.js 内嵌公钥验签（服务器推送机制，
//    使今后协议换版无需发布新客户端）；
// 4. 写出 electron/resources/agreements-enc.json：
//    { revision, algorithm:'aes-256-gcm', nonce:b64, payload:b64, sha256,
//      signatureAlgorithm:'ed25519', signature:b64 }
//    （密文不含密钥，可随仓库提交并进入安装包）；
// 5. 把密钥以 `TEXT_KEY=<base64>` 行打印到 stdout（进度信息走 stderr），
//    供写入分发服务器 application.yml 的 app.legal.text-keys；密钥只存服务器，
//    绝不进入客户端仓库。
//
// 密钥换版流程：先在服务器配置新修订版密钥 → 再发布携带新密文的客户端，
// 保证旧客户端不被破坏、新客户端开箱可用。

import process from 'node:process'
import { createCipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGREEMENT_REVISION } from '../src/lib/agreements.mjs'
import { PINNED_AGREEMENT_TEXT_SHA256, agreementTexts } from './agreements-texts.mjs'

const KEY_BYTES = 32
const NONCE_BYTES = 12
const ALGORITHM = 'aes-256-gcm'
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const REVISION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const SIGNATURE_ALGORITHM = 'ed25519'
const SIGNATURE_MESSAGE_PREFIX = 'legal-agreement-v1'

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = path.join(TOOL_DIR, '..', 'electron', 'resources', 'agreements-enc.json')
const CLIENT_SECURE_PATH = path.join(TOOL_DIR, '..', 'electron', 'agreements-secure.js')
const SIGNING_KEY_PATH = path.join(TOOL_DIR, '..', '.local-keys', 'agreements-signing.json')

function info(message) {
  process.stderr.write(`${message}\n`)
}

function fail(message) {
  info(`错误：${message}`)
  process.exit(1)
}

function parseKeyArgument(argv) {
  const index = argv.indexOf('--key')
  if (index === -1) return null
  const value = argv[index + 1]
  if (typeof value !== 'string' || value.trim() === '') fail('--key 需要一个 base64 密钥参数')
  return value.trim()
}

function decodeStrictBase64(value) {
  if (typeof value !== 'string' || value === '' || value.length % 4 !== 0) return null
  if (!BASE64_PATTERN.test(value)) return null
  return Buffer.from(value, 'base64')
}

// 加载（或首次生成）作者协议签名密钥对；私钥只存 .local-keys/（已 gitignore）。
async function loadSigningKeys() {
  let stored = null
  try {
    stored = JSON.parse(await readFile(SIGNING_KEY_PATH, 'utf8'))
  } catch {
    // 首次运行生成新密钥对
  }
  if (stored?.algorithm === SIGNATURE_ALGORITHM && stored?.privateKeyPem && stored?.publicKeyPem) {
    info('使用既有协议签名密钥（.local-keys/agreements-signing.json）。')
    return stored
  }
  const { publicKey, privateKey } = generateKeyPairSync(SIGNATURE_ALGORITHM)
  stored = {
    algorithm: SIGNATURE_ALGORITHM,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).trim(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).trim(),
    createdAt: new Date().toISOString()
  }
  await mkdir(path.dirname(SIGNING_KEY_PATH), { recursive: true })
  await writeFile(SIGNING_KEY_PATH, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 })
  info(`已生成新的协议签名密钥对，私钥写入 ${SIGNING_KEY_PATH}（请确认其处于 gitignore 保护内）。`)
  return stored
}

// 强制校验客户端内嵌公钥与本工具使用的公钥一致，防止双方漂移导致验签全部失败。
async function assertClientPublicKeyMatches(publicKeyPem) {
  let source
  try {
    source = await readFile(CLIENT_SECURE_PATH, 'utf8')
  } catch {
    fail(`无法读取 ${CLIENT_SECURE_PATH}`)
  }
  const match = source.match(/const AGREEMENT_SIGNING_PUBLIC_KEY = \[\r?\n((?:.*\r?\n)+?)\].join\('\\n'\)/)
  if (!match) fail('electron/agreements-secure.js 缺少 AGREEMENT_SIGNING_PUBLIC_KEY 常量')
  const embedded = match[1]
    .split('\n')
    .map((line) => line.trim().replace(/^'|',?$/g, ''))
    .filter((line) => line.length > 0)
    .join('\n')
  const normalized = `${embedded}\n`
  const expected = `${publicKeyPem}\n`
  if (normalized !== expected) {
    fail([
      '客户端内嵌签名公钥与签名私钥不配对。',
      `客户端公钥指纹: ${createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16)}`,
      `签名公钥指纹:   ${createHash('sha256').update(expected, 'utf8').digest('hex').slice(0, 16)}`,
      '请把 .local-keys/agreements-signing.json 的 publicKeyPem 同步进 electron/agreements-secure.js。'
    ].join('\n'))
  }
  info('客户端内嵌签名公钥与签名私钥配对一致。')
}

const keyArgument = parseKeyArgument(process.argv)
let keyBase64
if (keyArgument === null) {
  keyBase64 = randomBytes(KEY_BYTES).toString('base64')
  info('已生成随机 32 字节密钥。')
} else {
  const provided = decodeStrictBase64(keyArgument)
  if (!provided || provided.length !== KEY_BYTES) fail('--key 必须是 32 字节（base64）的 AES-256 密钥')
  keyBase64 = keyArgument
  info('使用传入的既有密钥。')
}
const key = Buffer.from(keyBase64, 'base64')

if (agreementTexts?.length !== 2 || agreementTexts.map((text) => text.id).join(',') !== 'user,notice') {
  fail('协议正文源必须恰好包含 user → notice 两份全文')
}
for (const text of agreementTexts) {
  if (typeof text.body !== 'string' || text.body.trim() === '') fail(`《${text.title}》正文为空`)
  if (!text.body.includes(`协议修订号：${AGREEMENT_REVISION}`)) {
    fail(`《${text.title}》正文中的修订号与 AGREEMENT_REVISION（${AGREEMENT_REVISION}）不一致，请先同步文本源`)
  }
}
if (!REVISION_PATTERN.test(AGREEMENT_REVISION)) fail(`协议修订号含非法字符：${AGREEMENT_REVISION}`)

// 存证口径哈希：必须等于 pinned 值，否则说明正文或拼接口径发生了变化
const joined = agreementTexts.map((text) => text.body).join('\n')
const digest = createHash('sha256').update(joined, 'utf8').digest('hex')
if (digest !== PINNED_AGREEMENT_TEXT_SHA256) {
  fail([
    `协议全文哈希 ${digest} 与 pinned 值 ${PINNED_AGREEMENT_TEXT_SHA256} 不一致。`,
    '若为有意的正文换版：递增 AGREEMENT_REVISION，并同步更新 tools/agreements-texts.mjs、',
    'tools/encrypt-agreements.mjs（本文件）、electron/agreements-secure.js 三处 pinned SHA-256，',
    '重新生成密文、更换服务器密钥并发布新客户端。'
  ].join('\n'))
}

const signingKeys = await loadSigningKeys()
await assertClientPublicKeyMatches(signingKeys.publicKeyPem)
const signature = sign(null, Buffer.from(`${SIGNATURE_MESSAGE_PREFIX}:${AGREEMENT_REVISION}:${digest}`, 'utf8'), createPrivateKey(signingKeys.privateKeyPem))

const nonce = randomBytes(NONCE_BYTES)
const cipher = createCipheriv(ALGORITHM, key, nonce)
const ciphertext = Buffer.concat([cipher.update(JSON.stringify(agreementTexts.map(({ id, body }) => ({ id, body }))), 'utf8'), cipher.final()])
const payload = Buffer.concat([ciphertext, cipher.getAuthTag()])

const bundle = {
  revision: AGREEMENT_REVISION,
  algorithm: ALGORITHM,
  nonce: nonce.toString('base64'),
  payload: payload.toString('base64'),
  sha256: digest,
  signatureAlgorithm: SIGNATURE_ALGORITHM,
  signature: signature.toString('base64')
}

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
await writeFile(OUTPUT_PATH, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')

info(`密文已写入：${OUTPUT_PATH}`)
info(`协议修订版：${AGREEMENT_REVISION}`)
info(`全文 SHA-256（存证口径）：${digest}`)
info('请把下面 TEXT_KEY 写入分发服务器 /opt/msfs-pch/application.yml 的 app.legal.text-keys（不要提交到任何仓库）：')
process.stdout.write(`TEXT_KEY=${keyBase64}\n`)
