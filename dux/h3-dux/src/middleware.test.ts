/**
 * Typed middleware bindings (delta 12) — runtime plane. Middleware keeps h3
 * semantics and gains one capability: publishing typed `event.bindings` that
 * downstream middleware and handlers read. `staged` is private preparation;
 * `requires` consumes a capability without re-registering it.
 */
import { createRouter, createServer, createTestClient, defineMiddleware } from '@mszr/h3-dux'
import { expect, it } from 'vitest'

it('a binding published by .use is readable on event.bindings downstream', async () => {
  const withRequestId = defineMiddleware({
    bindings: () => ({ requestId: 'req-123' }),
  })

  const app = createServer()
    .use(withRequestId)
    .get('/whoami', e => ({ requestId: e.bindings.requestId }))
  const api = createTestClient<typeof app>(app)

  const { data } = await api.get('/whoami')
  expect(data).toEqual({ requestId: 'req-123' })
})

it('staged feeds bindings but never leaks to the handler payload', async () => {
  const seen: Record<string, unknown> = {}
  const withUser = defineMiddleware({
    staged: () => ({ token: 'abc' }),
    bindings: e => ({ user: { id: e.staged.token.toUpperCase() } }),
    handler(e, next) {
      seen.stagedInHandler = e.staged.token
      return next()
    },
  })

  const app = createServer()
    .use(withUser)
    .get('/me', e => e.bindings.user)
  const api = createTestClient<typeof app>(app)

  const { data } = await api.get('/me')
  expect(data).toEqual({ id: 'ABC' })
  expect(seen.stagedInHandler).toBe('abc')
})

it('staged scope is restored when bindings preparation throws', async () => {
  let restored: unknown
  const outer = defineMiddleware({
    staged: () => ({ scope: 'outer' }),
    async handler(e, next) {
      try {
        return await next()
      }
      catch {
        restored = e.staged
        return new Response('caught')
      }
    },
  })
  const inner = defineMiddleware({
    staged: () => ({ scope: 'inner' }),
    bindings: () => {
      throw new Error('boom')
    },
  })
  const app = createServer()
    .use(outer)
    .use(inner)
    .get('/x', () => null)

  const response = await app.request('/x')
  expect(await response.text()).toBe('caught')
  expect(restored).toEqual({ scope: 'outer' })
})

it('a chain of providers sees the earlier bindings (requires consumes, never re-runs)', async () => {
  let sessionRuns = 0
  const withSession = defineMiddleware({
    bindings: () => {
      sessionRuns++
      return { session: { tenant: 'acme' } }
    },
  })
  const withTenant = defineMiddleware({
    requires: [withSession],
    bindings: e => ({ tenant: e.bindings.session.tenant }),
  })

  const app = createServer()
    .use(withSession)
    .use(withTenant)
    .get('/tenant', e => ({ tenant: e.bindings.tenant }))
  const api = createTestClient<typeof app>(app)

  const { data } = await api.get('/tenant')
  expect(data).toEqual({ tenant: 'acme' })
  expect(sessionRuns).toBe(1) // withTenant.requires did not re-run withSession
})

it('a binding is mutable within one request', async () => {
  const withUser = defineMiddleware({
    bindings: () => ({ user: { name: 'guest' } }),
  })
  const app = createServer()
    .use(withUser)
    .use(defineMiddleware((e, next) => {
      ;(e.context as { bindings: { user: { name: string } } }).bindings.user.name = 'admin'
      return next()
    }))
    .get('/name', e => ({ name: e.bindings.user.name }))
  const api = createTestClient<typeof app>(app)

  expect((await api.get('/name')).data).toEqual({ name: 'admin' })
})

it('handler middleware can intercept by not calling next', async () => {
  const gate = defineMiddleware({
    handler: () => new Response('nope', { status: 403 }),
  })
  const app = createServer()
    .use(gate)
    .get('/secret', () => ({ ok: true }))

  const res = await app.request('/secret')
  expect(res.status).toBe(403)
})

it('router-scoped .use runs only for the router routes', async () => {
  let mark = 0
  const tag = defineMiddleware((_e, next) => {
    mark++
    return next()
  })
  const tagged = createRouter('/tagged').use(tag).get('/x', () => ({ ok: true }))

  const app = createServer()
    .mount(tagged)
    .get('/untagged', () => ({ ok: true }))

  await app.request('/untagged')
  expect(mark).toBe(0) // the router middleware did not run for a non-router route
  await app.request('/tagged/x')
  expect(mark).toBe(1)
})

it('a router .requires(provider) is satisfied by a parent .use at mount', async () => {
  const withUser = defineMiddleware({ bindings: () => ({ user: { id: 'u1' } }) })
  const account = createRouter('/account')
    .requires(withUser)
    .get('/me', e => e.bindings.user)

  const app = createServer().use(withUser).mount(account)
  const api = createTestClient<typeof app>(app)

  expect((await api.get('/account/me')).data).toEqual({ id: 'u1' })
})

it('endpoint middleware registers, runs, and publishes its bindings to the handler', async () => {
  const withUpload = defineMiddleware({ bindings: () => ({ upload: { size: 42 } }) })
  const app = createServer().post('/avatar', {
    middleware: [withUpload],
    handler: e => ({ size: e.bindings.upload.size }),
  })
  const api = createTestClient<typeof app>(app)

  expect((await api.post('/avatar')).data).toEqual({ size: 42 })
})
