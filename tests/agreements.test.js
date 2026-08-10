const test = require('node:test')
const assert = require('node:assert/strict')

test('agreement revision invalidates legacy consent and includes a disclaimer', async () => {
  const agreementModule = await import('../src/lib/agreements.mjs')

  assert.equal(agreementModule.hasAcceptedAgreements('accepted-v1'), false)
  assert.equal(agreementModule.hasAcceptedAgreements(agreementModule.AGREEMENT_ACCEPTANCE_VALUE), true)
  assert.equal(agreementModule.agreements.length, 2)
  assert.equal(agreementModule.agreements[1].title, '免责声明')
  assert.match(agreementModule.agreements[0].body, /协议修订号/)
  assert.match(agreementModule.agreements[1].body, /不得排除的法定责任/)
})
