const test = require('node:test')
const assert = require('node:assert/strict')
const {
  ANNOUNCEMENTS_ENDPOINT_PATH,
  ANNOUNCEMENTS_PAGE_SIZE,
  POPUP_ANNOUNCEMENTS_ENDPOINT_PATH,
  fetchAnnouncements,
  fetchPopupAnnouncements,
  normalizeAnnouncement
} = require('../electron/announcements')
const { SERVER_ORIGIN } = require('../electron/distribution-server')

function envelopeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }
}

function announcement(overrides = {}) {
  return {
    id: 3,
    title: '新版本发布公告',
    content: 'MSFS CAT CH v1.4 已发布，请及时更新。',
    imageUrl: null,
    popup: false,
    pinned: true,
    category: 'global',
    status: 'published',
    createdByUsername: 'admin',
    createdAt: '2026-09-13T14:00:00',
    ...overrides
  }
}

test('normalizes a valid announcement and fills defaults for optional flags', () => {
  const normalized = normalizeAnnouncement(announcement({ popup: true }))

  assert.deepEqual(normalized, {
    id: 3,
    title: '新版本发布公告',
    content: 'MSFS CAT CH v1.4 已发布，请及时更新。',
    imageUrl: null,
    popup: true,
    pinned: true,
    category: 'global',
    createdByUsername: 'admin',
    createdAt: '2026-09-13T14:00:00'
  })
})

test('drops announcements with invalid fields instead of failing the list', () => {
  const invalidEntries = [
    null,
    'not-an-object',
    announcement({ id: 0 }),
    announcement({ id: -1 }),
    announcement({ id: 2.5 }),
    announcement({ id: 4, title: '' }),
    announcement({ id: 5, title: '   ' }),
    announcement({ id: 6, content: null }),
    announcement({ id: 7, category: 'other' }),
    announcement({ id: 8, category: '' })
  ]
  const normalized = normalizeAnnouncement(announcement())
  for (const entry of invalidEntries) {
    assert.equal(normalizeAnnouncement(entry), null)
  }
  assert.ok(normalized)
})

test('fetches the announcement list through the paginated server endpoint', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    return envelopeResponse(200, {
      code: 200,
      message: 'ok',
      data: { content: [announcement(), announcement({ id: 9, pinned: false, category: 'software' })], totalElements: 2 }
    })
  }

  const result = await fetchAnnouncements({ fetchImpl })

  assert.equal(result.ok, true)
  assert.deepEqual(result.announcements.map((item) => item.id), [3, 9])
  assert.equal(calls.length, 1)
  assert.equal(calls[0], `${SERVER_ORIGIN}${ANNOUNCEMENTS_ENDPOINT_PATH}?page=0&size=${ANNOUNCEMENTS_PAGE_SIZE}`)
})

test('silently drops invalid entries from an otherwise valid list', async () => {
  const fetchImpl = async () => envelopeResponse(200, {
    code: 200,
    data: {
      content: [
        announcement(),
        announcement({ id: 0, title: '坏 id' }),
        announcement({ id: 4, title: '', category: 'software' }),
        announcement({ id: 5, content: null }),
        announcement({ id: 6, category: 'topic' })
      ]
    }
  })

  const result = await fetchAnnouncements({ fetchImpl })

  assert.equal(result.ok, true)
  assert.deepEqual(result.announcements.map((item) => item.id), [3])
})

test('accepts global, software, and patch-prefixed categories only', async () => {
  const fetchImpl = async () => envelopeResponse(200, {
    code: 200,
    data: {
      content: [
        announcement({ id: 1, category: 'global' }),
        announcement({ id: 2, category: 'software' }),
        announcement({ id: 3, category: 'patch:gsx' }),
        announcement({ id: 4, category: 'patch' })
      ]
    }
  })

  const result = await fetchAnnouncements({ fetchImpl })

  assert.equal(result.ok, true)
  assert.deepEqual(result.announcements.map((item) => item.category), ['global', 'software', 'patch:gsx'])
})

test('rejects a non-200 HTTP response', async () => {
  const result = await fetchAnnouncements({ fetchImpl: async () => envelopeResponse(500, { code: 500 }) })

  assert.equal(result.ok, false)
  assert.match(result.error, /HTTP 500/)
})

test('rejects an envelope whose code is not 200', async () => {
  const result = await fetchAnnouncements({
    fetchImpl: async () => envelopeResponse(200, { code: 500, message: 'error', data: { content: [] } })
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /code 500/)
})

test('rejects an envelope whose content is not an array', async () => {
  const result = await fetchAnnouncements({
    fetchImpl: async () => envelopeResponse(200, { code: 200, data: { content: 'nope' } })
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /格式无效/)
})

test('reports an unreachable announcement server without throwing', async () => {
  const result = await fetchAnnouncements({ fetchImpl: async () => { throw new Error('ECONNRESET') } })

  assert.equal(result.ok, false)
  assert.match(result.error, /无法连接公告服务器/)
})

test('fetchPopupAnnouncements reads the popup endpoint and array envelope', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    return envelopeResponse(200, { code: 200, message: 'ok', data: [announcement({ id: 7, popup: true })] })
  }

  const result = await fetchPopupAnnouncements({ fetchImpl })

  assert.equal(result.ok, true)
  assert.deepEqual(result.announcements.map((item) => item.id), [7])
  assert.equal(result.announcements[0].popup, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0], `${SERVER_ORIGIN}${POPUP_ANNOUNCEMENTS_ENDPOINT_PATH}`)
})

test('fetchPopupAnnouncements rejects a non-array popup envelope', async () => {
  const result = await fetchPopupAnnouncements({
    fetchImpl: async () => envelopeResponse(200, { code: 200, data: { content: [] } })
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /格式无效/)
})

test('fetchPopupAnnouncements reports network failures like the list endpoint', async () => {
  const result = await fetchPopupAnnouncements({ fetchImpl: async () => { throw new Error('ETIMEDOUT') } })

  assert.equal(result.ok, false)
  assert.match(result.error, /无法连接公告服务器/)
})
