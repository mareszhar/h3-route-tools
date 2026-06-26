/**
 * The bare-handler shorthand — runtime plane. When no options are needed, a verb
 * (server or router) and `defineFileRoute` / a file-route factory accept the
 * handler directly: `app.get('/x', e => …)`. It is sugar for `{ handler: e => … }`,
 * so defaults (eager validation, inferred response, response kind) all still apply.
 */
import { createFileRouteFactory, createRouter, createServer, createTestClient, defineFileRoute, defineMiddleware } from '@mszr/h3-dux'
import { H3 } from 'h3'
import { expect, it } from 'vitest'

it('a server verb accepts a bare handler', async () => {
  const app = createServer().get('/health', () => ({ status: 'ripe' as const }))
  const api = createTestClient<typeof app>(app)
  const { data, error } = await api.get('/health')
  expect(error).toBeUndefined()
  expect(data).toEqual({ status: 'ripe' })
})

it('a bare server handler still sees pattern-inferred params', async () => {
  const app = createServer().get('/fruits/:id', e => ({ id: e.params.id }))
  const api = createTestClient<typeof app>(app)
  const { data } = await api.get('/fruits/:id', { params: { id: 'mango' } })
  expect(data).toEqual({ id: 'mango' })
})

it('a router verb accepts a bare handler', async () => {
  const ping = createRouter('/ping').get('/', () => ({ ok: true as const }))
  const app = createServer().mount(ping)
  const api = createTestClient<typeof app>(app)
  expect((await api.get('/ping')).data).toEqual({ ok: true })
})

it('defineFileRoute accepts a bare handler', async () => {
  const route = defineFileRoute(() => ({ status: 'ripe' as const }))
  const app = new H3().all('/health', route)
  expect(await (await app.request('/health')).json()).toEqual({ status: 'ripe' })
})

it('a factory call accepts a bare handler, with bindings in scope', async () => {
  const withRequestId = defineMiddleware({ bindings: () => ({ requestId: 'req-1' }) })
  const defineAppRoute = createFileRouteFactory().use(withRequestId)
  const route = defineAppRoute(e => ({ requestId: e.bindings.requestId }))
  const app = new H3().all('/whoami', route)
  expect(await (await app.request('/whoami')).json()).toEqual({ requestId: 'req-1' })
})

it('.use accepts a bare callback (no defineMiddleware wrap) that reads chain bindings', async () => {
  const seen: string[] = []
  const withSession = defineMiddleware({ bindings: () => ({ tenant: 'acme' }) })
  const app = createServer()
    .use(withSession)
    // Bare callback — the inline equivalent of defineMiddleware(fn).
    .use((e, next) => {
      seen.push(e.bindings.tenant)
      return next()
    })
    .get('/x', () => ({ ok: true as const }))
  await app.request('/x')
  expect(seen).toEqual(['acme'])
})

it('a bare .use callback installs the dux accessors even with no prior middleware', async () => {
  let hadBindings = false
  const app = createServer()
    .use((e, next) => {
      // event.bindings is always present (accessors installed), even when empty.
      hadBindings = typeof e.bindings === 'object' && e.bindings !== null
      return next()
    })
    .get('/x', () => ({ ok: true as const }))
  await app.request('/x')
  expect(hadBindings).toBe(true)
})
