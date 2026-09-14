const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

test('agreement revision invalidates legacy consent and keeps section metadata only', async () => {
  const agreementModule = await import('../src/lib/agreements.mjs')

  assert.equal(agreementModule.hasAcceptedAgreements('accepted-v1'), false)
  assert.equal(agreementModule.hasAcceptedAgreements(agreementModule.AGREEMENT_ACCEPTANCE_VALUE), true)
  assert.equal(agreementModule.AGREEMENT_SECTIONS.length, 2)
  assert.equal(agreementModule.AGREEMENT_SECTIONS[0].id, 'user')
  assert.equal(agreementModule.AGREEMENT_SECTIONS[1].title, '免责声明')
  assert.equal(agreementModule.agreements, undefined, '协议正文不得再从渲染层模块导出')
})

test('renderer agreement module ships no plaintext bodies', async () => {
  const modulePath = path.join(__dirname, '..', 'src', 'lib', 'agreements.mjs')
  const source = await fs.readFile(modulePath, 'utf8')
  // 明文正文中的标志性片段不得残留在渲染层模块
  for (const plaintextFragment of ['生效日期：', '协议修订号：2026', '不得排除的法定责任', '同意并继续使用']) {
    assert.ok(!source.includes(plaintextFragment), `渲染层模块不得包含明文片段：${plaintextFragment}`)
  }
})
