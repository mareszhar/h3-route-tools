/**
 * The bare-handler shorthand — type plane. The callback form preserves end-to-end
 * typing exactly as the options form: the response is inferred from the return, the
 * event is typed (pattern params, bindings), and the client reads it from `typeof app`.
 */
import type { FileFlatContract } from '@mszr/h3-dux'
import { createClient, createFileRouteFactory, createRouter, createServer, defineFileRoute, defineMiddleware } from '@mszr/h3-dux'
import { expectTypeOf, test } from 'vitest'

test('a bare server handler infers the response end-to-end', async () => {
  const _app = createServer().get('/health', () => ({ status: 'ripe' as const, at: 1 }))
  const api = createClient<typeof _app>({ baseURL: '' })
  expectTypeOf(await api.get('/health').orThrow()).toEqualTypeOf<{ status: 'ripe', at: number }>()
})

test('a bare server handler types its event from the pattern', () => {
  createServer().get('/fruits/:id', (e) => {
    expectTypeOf(e.params.id).toEqualTypeOf<string>()
    expectTypeOf(e.body).toEqualTypeOf<unknown>()
    return null
  })
})

test('a bare router handler sees the prefix params', () => {
  createRouter('/users/:userId/friends').get('/:friendId', (e) => {
    expectTypeOf(e.params.userId).toEqualTypeOf<string>()
    expectTypeOf(e.params.friendId).toEqualTypeOf<string>()
    return null
  })
})

test('a bare file-route handler infers the response through the generated map', async () => {
  const _r = defineFileRoute(() => ({ status: 'ripe' as const }))
  interface Routes { '/health': { get: FileFlatContract<typeof _r, 'get', object> } }
  const api = createClient<Routes>({ baseURL: '' })
  expectTypeOf(await api.get('/health').orThrow()).toEqualTypeOf<{ status: 'ripe' }>()
})

test('a factory bare handler has the published bindings typed', () => {
  const withRequestId = defineMiddleware({ bindings: () => ({ requestId: 'x' }) })
  const defineAppRoute = createFileRouteFactory().use(withRequestId)
  defineAppRoute((e) => {
    expectTypeOf(e.bindings.requestId).toEqualTypeOf<string>()
    return null
  })
})

test('a bare .use callback types its event.bindings from the chain', () => {
  const withSession = defineMiddleware({ bindings: () => ({ tenant: 'acme' }) })
  createServer().use(withSession).use((e, next) => {
    expectTypeOf(e.bindings.tenant).toEqualTypeOf<string>()
    expectTypeOf(e.bindings).toMatchTypeOf<{ tenant: string }>()
    return next()
  })
})
