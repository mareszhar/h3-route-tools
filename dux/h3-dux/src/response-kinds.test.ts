import type { App } from '@test'
import { binary, createServer, createTestClient, text, typedResponse } from '@mszr/h3-dux'
import { app } from '@test'
import { expect, it } from 'vitest'

const api = createTestClient<App>(app)

it('a string response is inferred as text, with no marker', async () => {
  const { data, error } = await api.get('/health/text')
  expect(error).toBeUndefined()
  expect(data).toBe('ripe')
  expect(typeof data).toBe('string')
})

it('an inferred string response is sent as text/plain', async () => {
  const res = await api.get('/health/text').raw()
  expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
  expect(res.headers.get('content-type')).toContain('dux-kind=text')
})

it('a numeric-looking string stays a string without text()', async () => {
  // The Gen-1 decode JSON.parse'd any non-JSON body, so "42" became 42. It must not.
  const tiny = createServer().get('/n', { handler: () => '42' })
  const tinyApi = createTestClient<typeof tiny>(tiny)
  const { data } = await tinyApi.get('/n')
  expect(data).toBe('42')
  expect(typeof data).toBe('string')
})

it('a Blob response is inferred as binary with the bytes intact', async () => {
  const { data, error } = await api.get('/fruits/:id/label', { params: { id: 'mango' } })
  expect(error).toBeUndefined()
  expect(data).toBeInstanceOf(Blob)
  expect(await data!.text()).toBe('🥭 Mango')
})

it('an inferred binary response is sent as application/octet-stream by default', async () => {
  const res = await api.get('/fruits/:id/label', { params: { id: 'mango' } }).raw()
  expect(res.headers.get('content-type')).toBe('application/octet-stream; dux-kind=binary')
})

it('a 204 response resolves to data: undefined (the empty kind)', async () => {
  const call = api.delete('/fruits/:id', { params: { id: 'kiwi' } })
  const { data, error } = await call
  expect(error).toBeUndefined()
  expect(data).toBeUndefined()
  const empty = createServer().delete('/empty', { status: 204, handler: () => undefined })
  const raw = await createTestClient<typeof empty>(empty).delete('/empty').raw()
  expect(raw.headers.get('content-type')).toBeNull()
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

it('empty text stays an empty string, not undefined', async () => {
  const app = createServer().get('/empty-text', { handler: () => '' })
  const value = await createTestClient<typeof app>(app).get('/empty-text').orThrow()
  expect(value).toBe('')
})

it('binary MIME and decoding kind are independent', async () => {
  const app = createServer()
    .get('/csv', { handler: () => new Blob(['a,b'], { type: 'text/csv' }) })
    .get('/json-file', { handler: () => new Blob(['{"x":1}'], { type: 'application/json' }) })
  const client = createTestClient<typeof app>(app)

  const csv = await client.get('/csv').orThrow()
  const jsonFile = await client.get('/json-file').orThrow()
  expect(csv).toBeInstanceOf(Blob)
  expect(jsonFile).toBeInstanceOf(Blob)
  expect(csv.type).toBe('text/csv')
  expect(jsonFile.type).toBe('application/json')
  expect(await csv.text()).toBe('a,b')
  expect(await jsonFile.text()).toBe('{"x":1}')
})

it('explicit text()/binary() remain available as overrides', async () => {
  const app = createServer()
    .get('/text', { validate: { response: text() }, handler: () => '42' })
    .get('/binary', {
      validate: { response: binary() },
      handler: () => new Blob(['a,b'], { type: 'text/csv' }),
    })
  const client = createTestClient<typeof app>(app)
  expect(await client.get('/text').orThrow()).toBe('42')
  expect(await client.get('/binary').orThrow()).toBeInstanceOf(Blob)
})

it('.raw().parse() decodes every kind through one typed runtime path', async () => {
  const emptyApp = createServer().delete('/empty', { status: 204, handler: () => undefined })
  const emptyApi = createTestClient<typeof emptyApp>(emptyApp)
  expect(await (await api.get('/health').raw()).parse()).toMatchObject({ status: 'ripe' })
  expect(await (await api.get('/health/text').raw()).parse()).toBe('ripe')
  expect(await (await api.get('/fruits/:id/label', { params: { id: 'mango' } }).raw()).parse())
    .toBeInstanceOf(Blob)
  expect(await (await emptyApi.delete('/empty').raw()).parse()).toBeUndefined()
})

it('typedResponse() keeps native Response bodies typed and self-describing', async () => {
  const app = createServer()
    .get('/native-json', { handler: () => typedResponse({ ok: true as const }, { status: 201 }) })
    .get('/native-text', { handler: () => typedResponse('42', { headers: { 'content-type': 'text/custom' } }) })
    .get('/native-binary', {
      handler: () => typedResponse(new Blob(['a,b'], { type: 'text/csv' })),
    })
    .get('/native-empty', { handler: () => typedResponse() })
  const client = createTestClient<typeof app>(app)

  expect(await client.get('/native-json').orThrow()).toEqual({ ok: true })
  expect(await client.get('/native-text').orThrow()).toBe('42')
  const binary = await client.get('/native-binary').orThrow()
  expect(binary).toBeInstanceOf(Blob)
  expect(binary.type).toBe('text/csv')
  expect(await client.get('/native-empty').orThrow()).toBeUndefined()

  const raw = await client.get('/native-json').raw()
  expect(raw).toBeInstanceOf(Response)
  expect(raw.status).toBe(201)
  expect(await raw.parse()).toEqual({ ok: true })
})

it('opaque +json native responses decode as JSON at runtime', async () => {
  const app = createServer().get('/problem', {
    handler: () => new Response('{"title":"nope"}', {
      headers: { 'content-type': 'application/problem+json' },
    }),
  })
  expect(await createTestClient<typeof app>(app).get('/problem').orThrow()).toEqual({ title: 'nope' })
})
