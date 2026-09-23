const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { downloadToFile, isAllowedDownloadUrl } = require('../electron/patch-installer')

// downloadToFile 只认分发服务器主机名；测试用 hooks 注入本地 http 与放行守卫
const hooks = {
  urlGuard: () => true,
  getTransport: () => http
}

const PAYLOAD = Buffer.from('0123456789'.repeat(200)) // 2000 字节测试载荷

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.unref() // keep-alive 连接不阻止测试进程退出
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/file.bin` }))
  })
}

test('downloadToFile completes a plain 200 download and renames the part file', async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Length': PAYLOAD.length })
    res.end(PAYLOAD)
  })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-plain-'))
  const destination = path.join(root, 'file.bin')
  const result = await downloadToFile(url, destination, null, 6, hooks)
  assert.equal(result, destination)
  assert.deepEqual(await fs.readFile(destination), PAYLOAD)
  await assert.rejects(() => fs.stat(`${destination}.part`), /ENOENT/)
  server.close()
  await fs.rm(root, { recursive: true, force: true })
})

test('downloadToFile resumes from an existing part file via Range request', async () => {
  const half = PAYLOAD.subarray(0, 1000)
  const { server, url } = await startServer((req, res) => {
    const range = /bytes=(\d+)-/.exec(req.headers.range || '')
    if (range) {
      const start = Number(range[1])
      const body = PAYLOAD.subarray(start)
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
        'Content-Length': body.length
      })
      res.end(body)
      return
    }
    res.writeHead(200, { 'Content-Length': PAYLOAD.length })
    res.end(PAYLOAD)
  })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-resume-'))
  const destination = path.join(root, 'file.bin')
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(`${destination}.part`, half)

  let sawRange = false
  const originalGet = http.get
  // 断言 Range 头确实携带
  const patched = { ...http, get: (u, opts, cb) => {
    if (opts?.headers?.Range) sawRange = true
    return originalGet(u, opts, cb)
  } }
  require.cache[require.resolve('node:http')]?.(); // no-op，直接以 hooks.getTransport 注入补丁
  const result = await downloadToFile(url, destination, null, 6, {
    ...hooks,
    getTransport: () => {
      const real = require('node:http')
      return new Proxy(real, { get: (t, prop) => (prop === 'get' ? patched.get : t[prop]) })
    }
  })
  assert.equal(sawRange, true, '应携带 Range: bytes=1000- 续传头')
  assert.equal(result, destination)
  assert.deepEqual(await fs.readFile(destination), PAYLOAD)
  server.close()
  await fs.rm(root, { recursive: true, force: true })
})

test('mid-stream failures keep the part file and reject with a resume hint instead of ENOENT', async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Length': PAYLOAD.length })
    res.write(PAYLOAD.subarray(0, 500))
    setTimeout(() => res.destroy(), 20) // 中途断流（模拟网络闪断）
  })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-broken-'))
  const destination = path.join(root, 'file.bin')

  await assert.rejects(
    () => downloadToFile(url, destination, null, 6, hooks),
    (error) => /下载(不完整|中断)/.test(error.message) && !/ENOENT/.test(error.message),
    '应报出带续传提示的真实错误而非 ENOENT'
  )
  const part = await fs.readFile(`${destination}.part`)
  assert.equal(part.length, 500, '.part 应保留 500 字节断点')

  // 第二次：换成完整服务器 → 自动从断点续传到完整文件
  const full = await startServer((req, res) => {
    const range = /bytes=(\d+)-/.exec(req.headers.range || '')
    const start = range ? Number(range[1]) : 0
    const body = PAYLOAD.subarray(start)
    res.writeHead(range ? 206 : 200, range
      ? { 'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`, 'Content-Length': body.length }
      : { 'Content-Length': PAYLOAD.length })
    res.end(body)
  })
  const result = await downloadToFile(full.url, destination, null, 6, hooks)
  assert.equal(result, destination)
  assert.deepEqual(await fs.readFile(destination), PAYLOAD)
  server.close()
  full.server.close()
  await fs.rm(root, { recursive: true, force: true })
})

test('a stale part file resumes byte-wise; integrity is enforced by caller checksums', async () => {
  const { server, url } = await startServer((req, res) => {
    const range = /bytes=(\d+)-/.exec(req.headers.range || '')
    const start = range ? Number(range[1]) : 0
    const body = PAYLOAD.subarray(start)
    res.writeHead(range ? 206 : 200, range
      ? { 'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`, 'Content-Length': body.length }
      : { 'Content-Length': PAYLOAD.length })
    res.end(body)
  })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-corrupt-'))
  const destination = path.join(root, 'file.bin')
  // 陈旧 .part：字节级续传按偏移拼接，拼接结果由调用方 SHA-256 校验兜底
  // （presetPackages hashFile / 补丁安装校验失败即删除文件要求重试）
  await fs.writeFile(`${destination}.part`, Buffer.from('stale-data'))
  const result = await downloadToFile(url, destination, null, 6, hooks)
  assert.equal(result, destination)
  assert.deepEqual(await fs.readFile(destination), Buffer.concat([Buffer.from('stale-data'), PAYLOAD.subarray(10)]))
  server.close()
  await fs.rm(root, { recursive: true, force: true })
})

test('untrusted hosts stay rejected', async () => {
  assert.equal(isAllowedDownloadUrl('http://evil.example.com/file.bin'), false)
})
