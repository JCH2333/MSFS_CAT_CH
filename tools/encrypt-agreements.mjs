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
// 3. 写出 electron/resources/agreements-enc.json：
//    { revision, algorithm:'aes-256-gcm', nonce:b64, payload:b64, sha256 }
//    （密文不含密钥，可随仓库提交并进入安装包）；
// 4. 把密钥以 `TEXT_KEY=<base64>` 行打印到 stdout（进度信息走 stderr），
//    供写入分发服务器 application.yml 的 app.legal.text-keys；密钥只存服务器，
//    绝不进入客户端仓库。
//
// 密钥换版流程：先在服务器配置新修订版密钥 → 再发布携带新密文的客户端，
// 保证旧客户端不被破坏、新客户端开箱可用。

import process from 'node:process'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGREEMENT_REVISION } from '../src/lib/agreements.mjs'
import { PINNED_AGREEMENT_TEXT_SHA256, agreementTexts } from './agreements-texts.mjs'

const KEY_BYTES = 32
const NONCE_BYTES = 12
const ALGORITHM = 'aes-256-gcm'
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const REVISION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = path.join(TOOL_DIR, '..', 'electron', 'resources', 'agreements-enc.json')

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
  ].join(''))
}

const nonce = randomBytes(NONCE_BYTES)
const cipher = createCipheriv(ALGORITHM, key, nonce)
const ciphertext = Buffer.concat([cipher.update(JSON.stringify(agreementTexts.map(({ id, body }) => ({ id, body }))), 'utf8'), cipher.final()])
const payload = Buffer.concat([ciphertext, cipher.getAuthTag()])

const bundle = {
  revision: AGREEMENT_REVISION,
  algorithm: ALGORITHM,
  nonce: nonce.toString('base64'),
  payload: payload.toString('base64'),
  sha256: digest
}

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
await writeFile(OUTPUT_PATH, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')

info(`密文已写入：${OUTPUT_PATH}`)
info(`协议修订版：${AGREEMENT_REVISION}`)
info(`全文 SHA-256（存证口径）：${digest}`)
info('请把下面 TEXT_KEY 写入分发服务器 /opt/msfs-pch/application.yml 的 app.legal.text-keys（不要提交到任何仓库）：')
process.stdout.write(`TEXT_KEY=${keyBase64}\n`)
