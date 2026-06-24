import type { App } from '@test'
import { createServer, createTestClient, text } from '@mszr/h3-dux'
import { app } from '@test'
import { expect, it } from 'vitest'

const api = createTestClient<App>(app)

it('a text() response resolves to a string, not parsed JSON', async () => {
  const { data, error } = await api.get('/health/text')
  expect(error).toBeUndefined()
  expect(data).toBe('ripe')
  expect(typeof data).toBe('string')
})

it('a text() response is sent as text/plain', async () => {
  const res = await api.get('/health/text').raw()
  expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
})

it('a numeric text() body stays a string (never re-parsed to a number)', async () => {
  // The Gen-1 decode JSON.parse'd any non-JSON body, so "42" became 42. It must not.
  const tiny = createServer().get('/n', { validate: { response: text() }, handler: () => '42' })
  const tinyApi = createTestClient<typeof tiny>(tiny)
  const { data } = await tinyApi.get('/n')
  expect(data).toBe('42')
  expect(typeof data).toBe('string')
})

it('a binary() response resolves to a Blob with the bytes intact', async () => {
  const { data, error } = await api.get('/fruits/:id/label', { params: { id: 'mango' } })
  expect(error).toBeUndefined()
  expect(data).toBeInstanceOf(Blob)
  expect(await data!.text()).toBe('🥭 Mango')
})

it('a binary() response is sent as application/octet-stream by default', async () => {
  const res = await api.get('/fruits/:id/label', { params: { id: 'mango' } }).raw()
  expect(res.headers.get('content-type')).toBe('application/octet-stream')
})

it('a 204 response resolves to data: undefined (the empty kind)', async () => {
  const { data, error } = await api.delete('/fruits/:id', { params: { id: 'kiwi' } })
  expect(error).toBeUndefined()
  expect(data).toBeUndefined()
})

it('a native Response handler return passes through, consumed via .raw()', async () => {
  const raw = createServer().get('/raw', {
    handler: () => new Response('hi there', { status: 201, headers: { 'content-type': 'text/plain' } }),
  })
  const rawApi = createTestClient<typeof raw>(raw)
  const res = await rawApi.get('/raw').raw()
  expect(res.status).toBe(201)
  expect(await res.text()).toBe('hi there')
})
