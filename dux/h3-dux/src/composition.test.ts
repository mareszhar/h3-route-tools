/**
 * Delta-aware composition (delta 11) — runtime plane. A router carries the deltas
 * and accumulates without mounting; `createServer().mount(router)` folds it into a
 * flat, typed route map the client reads end-to-end.
 */
import { createRouter, createServer, createTestClient, defineMiddleware } from '@mszr/h3-dux'
import { createOrchard, FruitSchema, NewFruitSchema } from '@test'
import * as v from 'valibot'
import { expect, it } from 'vitest'

function buildApp() {
  const orchard = createOrchard()

  const fruits = createRouter('/fruits')
    .get('/:id', { validate: { response: FruitSchema }, handler: e => orchard.get(e.params.id) })
    .post('/', { status: 201, validate: { body: NewFruitSchema }, handler: e => orchard.create(e.body) })

  const app = createServer().mount(fruits)
  return { app, orchard }
}

it('a mounted router answers on its prefixed paths', async () => {
  const { app } = buildApp()
  const api = createTestClient<typeof app>(app)

  const { data, error } = await api.get('/fruits/:id', { params: { id: 'mango' } })
  expect(error).toBeUndefined()
  expect(data?.name).toBe('Mango')
})

it('the router prefix joins a root-local path back to the bare prefix', async () => {
  const { app } = buildApp()
  const api = createTestClient<typeof app>(app)

  const { data, error } = await api.post('/fruits', {
    body: { name: 'Lychee', emoji: '🥟', color: 'pink', tags: ['sweet'], pricePerKg: 9, stockKg: 3 },
  })
  expect(error).toBeUndefined()
  expect(data?.id).toBe('lychee')
})

it('a dynamic prefix is inferred in every child handler (event.params.userId)', async () => {
  const friends = createRouter('/users/:userId/friends')
    .get('/:friendId', {
      handler: e => ({ userId: e.params.userId, friendId: e.params.friendId }),
    })

  const app = createServer().mount(friends)
  const api = createTestClient<typeof app>(app)

  const { data } = await api.get('/users/:userId/friends/:friendId', {
    params: { userId: 'ada', friendId: 'grace' },
  })
  expect(data).toEqual({ userId: 'ada', friendId: 'grace' })
})

it('mount(outerPrefix, router) prepends a static version segment', async () => {
  const ping = createRouter('/ping').get('/', () => ({ ok: true as const }))
  const app = createServer().mount('/v1', ping)
  const api = createTestClient<typeof app>(app)

  const { data } = await api.get('/v1/ping')
  expect(data).toEqual({ ok: true })
})

it('parentParams lets a dynamic outer mount own a segment the router consumes', async () => {
  const friends = createRouter('/friends', { parentParams: ['userId'] })
    .get('/:friendId', {
      handler: e => ({ userId: e.params.userId, friendId: e.params.friendId }),
    })

  const app = createServer().mount('/users/:userId', friends)
  const api = createTestClient<typeof app>(app)

  const { data } = await api.get('/users/:userId/friends/:friendId', {
    params: { userId: 'ada', friendId: 'grace' },
  })
  expect(data).toEqual({ userId: 'ada', friendId: 'grace' })
})

it('two routers compose into one flat client map', async () => {
  const orchard = createOrchard()
  const fruits = createRouter('/fruits').get('/:id', e => orchard.get(e.params.id))
  const health = createRouter().get('/health', () => ({ status: 'ripe' as const }))

  const app = createServer().mount(fruits).mount(health)
  const api = createTestClient<typeof app>(app)

  expect((await api.get('/health')).data).toEqual({ status: 'ripe' })
  expect((await api.get('/fruits/:id', { params: { id: 'kiwi' } })).data?.name).toBe('Kiwi')
})

it('router middleware is captured in registration order, not applied retroactively', async () => {
  let runs = 0
  const router = createRouter('/ordered')
    .get('/before', () => ({ ok: true }))
    .use(defineMiddleware((_event, next) => {
      runs++
      return next()
    }))
    .get('/after', () => ({ ok: true }))

  const app = createServer().mount(router)
  await app.request('/ordered/before')
  expect(runs).toBe(0)
  await app.request('/ordered/after')
  expect(runs).toBe(1)
})

it('.register folds a baseline defineRoute plugin into the accumulated map', async () => {
  // Native escape hatch: routes added through the owned baseline still accumulate.
  const { defineRoute } = await import('@mszr/h3-dux')
  const plugin = defineRoute({
    route: '/legacy',
    get: { validate: { response: v.object({ legacy: v.boolean() }) }, handler: () => ({ legacy: true }) },
  })
  const app = createServer().register(plugin)
  const api = createTestClient<typeof app>(app)

  const res = await api('/legacy', { method: 'get' })
  expect(await res.json()).toEqual({ legacy: true })
})
