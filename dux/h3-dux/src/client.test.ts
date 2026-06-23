import type { App } from '@test'
import { createClient } from '@mszr/h3-dux'
import { app } from '@test'
import { expect, it } from 'vitest'

const api = createClient<App>({ fetch: app.request })

it('round-trips a typed GET via verb sugar', async () => {
  const res = await api.get('/fruits/:id', { params: { id: 'mango' } })
  expect(res.status).toBe(200)
  expect((await res.json()).name).toBe('Mango')
})

it('the bare call and verb sugar hit the same endpoint', async () => {
  const viaVerb = await (await api.get('/health')).json()
  const viaBare = await (await api('/health', { method: 'get' })).json()
  expect(viaVerb.status).toBe('ripe')
  expect(viaBare.status).toBe('ripe')
})

it('resolves an interpolated path', async () => {
  const id = 'kiwi'
  const res = await api.get(`/fruits/${id}`)
  expect((await res.json()).name).toBe('Kiwi')
})

it('posts a new fruit and gets 201 with the created body', async () => {
  const res = await api.post('/fruits', {
    body: { name: 'Lychee', emoji: '🫐', color: 'pink', tags: ['sweet'], pricePerKg: 12, stockKg: 3 },
  })
  expect(res.status).toBe(201)
  expect((await res.json()).id).toBe('lychee')
})
