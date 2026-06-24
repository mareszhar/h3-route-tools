import type { App } from '@test'
import { binary, createClient, createServer, text, typedResponse } from '@mszr/h3-dux'
import { expectTypeOf, test } from 'vitest'

const api = createClient<App>({ baseURL: '' })

test('a bare string types the client response as a string', async () => {
  expectTypeOf(await api.get('/health/text').orThrow()).toEqualTypeOf<string>()

  const { data } = await api.get('/health/text')
  expectTypeOf(data).toEqualTypeOf<string | undefined>()
})

test('a bare Blob types the client response as a Blob', async () => {
  expectTypeOf(await api.get('/fruits/:id/label', { params: { id: 'm' } }).orThrow())
    .toEqualTypeOf<Blob>()

  const { data } = await api.get('/fruits/:id/label', { params: { id: 'm' } })
  expectTypeOf(data).toEqualTypeOf<Blob | undefined>()
})

test('a 204 (empty kind) types the client response as undefined', async () => {
  expectTypeOf(await api.delete('/fruits/:id', { params: { id: 'm' } }).orThrow())
    .toEqualTypeOf<undefined>()
})

test('text() constrains the handler to return a string', () => {
  createServer().get('/x', {
    validate: { response: text() },
    // @ts-expect-error — a text() response handler must return a string
    handler: () => 42,
  })
})

test('binary() accepts a Blob/stream/bytes handler return', () => {
  createServer()
    .get('/blob', { validate: { response: binary() }, handler: () => new Blob(['x']) })
    .get('/bytes', { validate: { response: binary() }, handler: () => new Uint8Array([1, 2, 3]) })
})

test('a native Response return is allowed and is opaque to the client (use .raw())', async () => {
  const _raw = createServer().get('/raw', { handler: () => new Response('hi') })
  const rawApi = createClient<typeof _raw>({ baseURL: '' })
  expectTypeOf(await rawApi.get('/raw').orThrow()).toEqualTypeOf<unknown>()
})

test('typedResponse() gives a native Response an end-to-end body contract', async () => {
  const _app = createServer()
    .get('/json', { handler: () => typedResponse({ ok: true as const }) })
    .get('/text', { handler: () => typedResponse('42') })
    .get('/blob', { handler: () => typedResponse(new Blob(['x'], { type: 'text/plain' })) })
    .get('/empty', { handler: () => typedResponse() })
  const client = createClient<typeof _app>({ baseURL: '' })

  expectTypeOf(await client.get('/json').orThrow()).toEqualTypeOf<{ readonly ok: true }>()
  expectTypeOf(await client.get('/text').orThrow()).toEqualTypeOf<string>()
  expectTypeOf(await client.get('/blob').orThrow()).toEqualTypeOf<Blob>()
  expectTypeOf(await client.get('/empty').orThrow()).toEqualTypeOf<undefined>()
})

test('.raw() is kind-aware and parse() is the universal typed body reader', async () => {
  const textRaw = await api.get('/health/text').raw()
  expectTypeOf(await textRaw.parse()).toEqualTypeOf<string>()
  expectTypeOf(await textRaw.json()).toEqualTypeOf<unknown>()
  expectTypeOf(await textRaw.text()).toEqualTypeOf<string>()

  const binaryRaw = await api.get('/fruits/:id/label', { params: { id: 'm' } }).raw()
  expectTypeOf(await binaryRaw.parse()).toEqualTypeOf<Blob>()
  expectTypeOf(await binaryRaw.json()).toEqualTypeOf<unknown>()
  expectTypeOf(await binaryRaw.blob()).toEqualTypeOf<Blob>()

  const emptyRaw = await api.delete('/fruits/:id', { params: { id: 'm' } }).raw()
  expectTypeOf(await emptyRaw.parse()).toEqualTypeOf<undefined>()
})

test('204 and HEAD handlers cannot return a body', () => {
  createServer().get('/bad-204', {
    status: 204,
    // @ts-expect-error — a 204 cannot carry a body
    handler: () => ({ nope: true }),
  })
  createServer().head('/bad-head', {
    // @ts-expect-error — HEAD cannot carry a body
    handler: () => 'nope',
  })
  createServer().get('/bad-205', {
    status: 205,
    // @ts-expect-error — a 205 cannot carry a body
    handler: () => new Blob(['nope']),
  })
})
