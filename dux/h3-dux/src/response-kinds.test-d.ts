import type { App } from '@test'
import { binary, createClient, createServer, text } from '@mszr/h3-dux'
import { expectTypeOf, test } from 'vitest'

const api = createClient<App>({ baseURL: '' })

test('text() types the client response as a string', async () => {
  expectTypeOf(await api.get('/health/text').orThrow()).toEqualTypeOf<string>()

  const { data } = await api.get('/health/text')
  expectTypeOf(data).toEqualTypeOf<string | undefined>()
})

test('binary() types the client response as a Blob', async () => {
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
