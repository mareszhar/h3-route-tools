import type { App } from '@test'
import { createTestClient } from '@mszr/h3-dux'
import { app } from '@test'
import { expect, it } from 'vitest'

const api = createTestClient<App>(app)

it('eager mode: the validated body is on event.context.body (POST /fruits)', async () => {
  const res = await api.post('/fruits', {
    body: { name: 'Guava', emoji: '🫐', color: 'green', tags: ['tart'], pricePerKg: 6, stockKg: 4 },
  }).raw()
  expect(res.status).toBe(201)
  expect((await res.json()).id).toBe('guava')
})

it('manual mode: a dry-run import never validates or reads the body', async () => {
  // The body is garbage, but a dry-run must never touch it.
  const res = await app.request('/import?mode=dry-run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify('not-an-array'),
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, imported: 0 })
})

it('manual mode: a commit validates the body on demand (422 on bad input)', async () => {
  const res = await app.request('/import?mode=commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify('not-an-array'),
  })
  expect(res.status).toBe(422)
})

it('manual mode: a commit imports a valid body', async () => {
  const { data } = await api.post('/import', {
    query: { mode: 'commit' },
    body: [{ name: 'Papaya', emoji: '🥭', color: 'orange', tags: ['sweet'], pricePerKg: 4, stockKg: 9 }],
  })
  expect(data).toEqual({ ok: true, imported: 1 })
})
