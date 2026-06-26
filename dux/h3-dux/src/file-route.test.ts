/**
 * Nitro file routes (delta 13) — runtime plane. `defineFileRoute` and
 * `createFileRouteFactory` produce real h3 handlers that self-dispatch, validate,
 * tag response kinds, throw typed errors, and replay their middleware onion — the
 * same execution as the standalone server, reached through the filename instead of
 * a chained `.get(...)`. Mounted on a plain `H3` to stand in for Nitro's routing.
 */
import { createFileRouteFactory, defineFileRoute, defineMiddleware } from '@mszr/h3-dux'
import { createOrchard, ErrorSchema, FruitSchema, NewFruitSchema } from '@test'
import { H3 } from 'h3'
import * as v from 'valibot'
import { expect, it } from 'vitest'

const aFruit = { name: 'Lychee', emoji: '🫐', color: 'pink', tags: ['sweet'], pricePerKg: 12, stockKg: 3 }

it('a flat method-locked route validates the body and sets its success status', async () => {
  const orchard = createOrchard()
  const route = defineFileRoute({
    status: 201,
    validate: { body: NewFruitSchema, response: FruitSchema },
    handler: e => orchard.create(e.body),
  })
  const app = new H3().all('/fruits', route)

  const res = await app.request('/fruits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(aFruit),
  })
  expect(res.status).toBe(201)
  expect((await res.json()).id).toBe('lychee')
  // The response kind is tagged so the dux client decodes it without guessing.
  expect(res.headers.get('content-type')).toContain('dux-kind=json')
})

it('a flat route rejects an invalid body with 422', async () => {
  const route = defineFileRoute({
    validate: { body: NewFruitSchema },
    handler: e => e.body,
  })
  const app = new H3().all('/fruits', route)

  const res = await app.request('/fruits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  })
  expect(res.status).toBe(422)
  expect((await res.json()).data.source).toBe('body')
})

it('a flat shared handler answers every method on an unsuffixed file', async () => {
  const route = defineFileRoute(() => ({ status: 'ripe' as const }))
  const app = new H3().all('/health', route)

  expect(await (await app.request('/health')).json()).toEqual({ status: 'ripe' })
  expect(await (await app.request('/health', { method: 'PUT' })).json()).toEqual({ status: 'ripe' })
  // Auto-HEAD: the GET path runs, the body is omitted.
  const head = await app.request('/health', { method: 'HEAD' })
  expect(head.status).toBe(200)
  expect(await head.text()).toBe('')
})

it('a method map dispatches distinct contracts per method, sharing route params', async () => {
  const orchard = createOrchard()
  const route = defineFileRoute({
    params: v.object({ id: v.string() }),
    get: { validate: { response: FruitSchema }, handler: e => orchard.get(e.params.id) },
    delete: {
      status: 204,
      handler: (e) => {
        orchard.remove(e.params.id)
        return null
      },
    },
  })
  const app = new H3().all('/fruits/:id', route)

  const got = await app.request('/fruits/mango')
  expect((await got.json()).name).toBe('Mango')

  const removed = await app.request('/fruits/mango', { method: 'DELETE' })
  expect(removed.status).toBe(204)
})

it('manual validation defers the body until event.valid is called', async () => {
  const route = defineFileRoute({
    validate: {
      query: v.object({ mode: v.optional(v.picklist(['dry-run', 'commit']), 'commit') }),
      body: v.array(NewFruitSchema),
      eager: false,
    },
    handler: async (e) => {
      const { mode } = await e.valid('query')
      if (mode === 'dry-run')
        return { ok: true as const, imported: 0 }
      const fruits = await e.valid('body')
      return { ok: true as const, imported: fruits.length }
    },
  })
  const app = new H3().all('/import', route)

  const dry = await app.request('/import?mode=dry-run', { method: 'POST' })
  expect(await dry.json()).toEqual({ ok: true, imported: 0 })

  const commit = await app.request('/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([aFruit]),
  })
  expect(await commit.json()).toEqual({ ok: true, imported: 1 })
})

it('event.error throws the declared typed error', async () => {
  const route = defineFileRoute({
    errors: { 409: ErrorSchema },
    handler: (e) => {
      if (e.params.id === 'taken')
        throw e.error(409, { error: 'conflict', message: 'already reserved' })
      return { id: e.params.id, reserved: true as const }
    },
  })
  const app = new H3().all('/reserve/:id', route)

  const ok = await app.request('/reserve/free', { method: 'POST' })
  expect((await ok.json()).reserved).toBe(true)

  const conflict = await app.request('/reserve/taken', { method: 'POST' })
  expect(conflict.status).toBe(409)
  expect((await conflict.json()).data.error).toBe('conflict')
})

it('factory .use runs middleware and publishes bindings to the handler', async () => {
  const withRequestId = defineMiddleware({ bindings: () => ({ requestId: 'req-1' }) })
  const defineAppRoute = createFileRouteFactory().use(withRequestId)

  const route = defineAppRoute(e => ({ requestId: e.bindings.requestId }))
  const app = new H3().all('/whoami', route)

  expect(await (await app.request('/whoami')).json()).toEqual({ requestId: 'req-1' })
})

it('factory .compose satisfies a feature\'s requirement without re-running middleware', async () => {
  let dbRuns = 0
  const withDatabase = defineMiddleware({
    bindings: () => {
      dbRuns++
      return { database: { name: 'orchard' } }
    },
  })
  const withStore = defineMiddleware({
    requires: [withDatabase],
    bindings: e => ({ store: `store:${e.bindings.database.name}` }),
  })

  const base = createFileRouteFactory().use(withDatabase)
  const storeFeature = createFileRouteFactory().requires(withDatabase).use(withStore)
  const defineStoreRoute = base.compose(storeFeature)

  const route = defineStoreRoute(e => ({ store: e.bindings.store }))
  const app = new H3().all('/store', route)

  expect(await (await app.request('/store')).json()).toEqual({ store: 'store:orchard' })
  // withDatabase ran exactly once — compose did not register it twice.
  expect(dbRuns).toBe(1)
})

it('a route-local middleware runs around the handler', async () => {
  const seen: string[] = []
  const route = defineFileRoute({
    middleware: [defineMiddleware(async (_e, next) => {
      seen.push('before')
      const r = await next()
      seen.push('after')
      return r
    })],
    handler: () => {
      seen.push('handler')
      return { ok: true }
    },
  })
  const app = new H3().all('/wrapped', route)

  await app.request('/wrapped')
  expect(seen).toEqual(['before', 'handler', 'after'])
})
