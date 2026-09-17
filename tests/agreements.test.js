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

test('accepted consent value records an arbitrary pushed revision', async () => {
  const agreementModule = await import('../src/lib/agreements.mjs')

  // 内置修订版与任意服务器推送修订版都可记录；同意值必须能还原出修订号
  assert.equal(agreementModule.acceptanceValue(agreementModule.AGREEMENT_REVISION), agreementModule.AGREEMENT_ACCEPTANCE_VALUE)
  assert.equal(agreementModule.parseAcceptedAgreementRevision(agreementModule.AGREEMENT_ACCEPTANCE_VALUE), agreementModule.AGREEMENT_REVISION)
  assert.equal(agreementModule.parseAcceptedAgreementRevision('accepted-2027-01-01-v1'), '2027-01-01-v1')

  // 非同意值、空修订号与非法修订号一律视为未同意
  assert.equal(agreementModule.parseAcceptedAgreementRevision(null), null)
  assert.equal(agreementModule.parseAcceptedAgreementRevision('acknowledged-v1'), null)
  assert.equal(agreementModule.parseAcceptedAgreementRevision('accepted-'), null)
  assert.equal(agreementModule.parseAcceptedAgreementRevision('accepted-非法 revision!'), null)
})

test('renderer agreement module ships no plaintext bodies', async () => {
  const modulePath = path.join(__dirname, '..', 'src', 'lib', 'agreements.mjs')
  const source = await fs.readFile(modulePath, 'utf8')
  // 明文正文中的标志性片段不得残留在渲染层模块
  for (const plaintextFragment of ['生效日期：', '协议修订号：2026', '不得排除的法定责任', '同意并继续使用']) {
    assert.ok(!source.includes(plaintextFragment), `渲染层模块不得包含明文片段：${plaintextFragment}`)
  }
})
