import type { App } from '@test'
import { createTestClient } from '@mszr/h3-dux'
import { app } from '@test'
import { expect, it } from 'vitest'

const api = createTestClient<App>(app)

it('round-trips a typed GET via verb sugar — data-first', async () => {
  const { data, error } = await api.get('/fruits/:id', { params: { id: 'mango' } })
  expect(error).toBeUndefined()
  expect(data?.name).toBe('Mango')
})

it('the bare call and verb sugar hit the same endpoint', async () => {
  const viaVerb = await api.get('/health').orThrow()
  const viaBare = await (await api('/health', { method: 'get' })).json()
  expect(viaVerb.status).toBe('ripe')
  expect(viaBare.status).toBe('ripe')
})

it('resolves an interpolated path', async () => {
  const id = 'kiwi'
  const data = await api.get(`/fruits/${id}`).orThrow()
  expect(data.name).toBe('Kiwi')
})

it('.raw() exposes the native response (status, headers)', async () => {
  const res = await api.post('/fruits', {
    body: { name: 'Lychee', emoji: '🫐', color: 'pink', tags: ['sweet'], pricePerKg: 12, stockKg: 3 },
  }).raw()
  expect(res.status).toBe(201)
  expect((await res.json()).id).toBe('lychee')
})

it('posts a new fruit and gets the created body data-first', async () => {
  const { data } = await api.post('/fruits', {
    body: { name: 'Papaya', emoji: '🥭', color: 'orange', tags: ['sweet'], pricePerKg: 4, stockKg: 9 },
  })
  expect(data?.id).toBe('papaya')
})
