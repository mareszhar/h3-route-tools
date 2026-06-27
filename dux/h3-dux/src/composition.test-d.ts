import type { App, Fruit } from '@test'
import { createClient, createRouter, createServer, defineRoute } from '@mszr/h3-dux'
import { FruitSchema, NewFruitSchema } from '@test'
import { expectTypeOf, test } from 'vitest'

test('a router prefix is inferred in every child handler', () => {
  createRouter('/users/:userId/friends').get('/:friendId', {
    handler: (e) => {
      expectTypeOf(e.params.userId).toEqualTypeOf<string>()
      expectTypeOf(e.params.friendId).toEqualTypeOf<string>()
      return null
    },
  })
})

test('parentParams folds a dynamic outer segment into the child params', () => {
  const friends = createRouter('/friends', { parentParams: ['userId'] }).get('/:friendId', {
    handler: (e) => {
      expectTypeOf(e.params.userId).toEqualTypeOf<string>()
      expectTypeOf(e.params.friendId).toEqualTypeOf<string>()
      return null
    },
  })

  createServer().mount('/users/:userId', friends)

  // @ts-expect-error — the outer path does not supply the declared `userId`
  createServer().mount('/orgs/:orgId', friends)
  // @ts-expect-error — a parent-param router cannot be mounted without its dynamic outer path
  createServer().mount(friends)
})

test('a mounted router is addressable on its flat, prefixed path from the client', async () => {
  const fruits = createRouter('/fruits')
    .get('/:id', { validate: { response: FruitSchema }, handler: e => ({ id: e.params.id, name: 'x', emoji: 'x', color: 'x', tags: [], pricePerKg: 0, ripeness: 0, stockKg: 0 }) })
    .post('/', { status: 201, validate: { body: NewFruitSchema }, handler: e => ({ ...e.body, id: 'x', ripeness: 0 }) })
  const _app = createServer().mount(fruits)
  const api = createClient<typeof _app>({ baseURL: 'x' })

  // The route key is the full path; params come from the endpoint contract.
  expectTypeOf(await api.get('/fruits/:id', { params: { id: 'mango' } }).orThrow())
    .toEqualTypeOf<Fruit>()
})

test('a static outer mount prefixes the client routes', async () => {
  const ping = createRouter('/ping').get('/', { handler: () => ({ ok: true as const }) })
  const _app = createServer().mount('/v1', ping)
  const api = createClient<typeof _app>({ baseURL: 'x' })
  expectTypeOf(await api.get('/v1/ping').orThrow()).toEqualTypeOf<{ ok: true }>()
})

test('a duplicate route + method is a cursor error', () => {
  createServer()
    .get('/x', { handler: () => null })
    // @ts-expect-error — `/x` GET is already defined; the duplicate is rejected
    .get('/x', { handler: () => null })
})

test('duplicate param names across composition boundaries are cursor errors', () => {
  createRouter('/users/:id')
    // @ts-expect-error — the local route repeats the prefix param `id`
    .get('/friends/:id', { handler: () => null })

  createRouter('/friends', { parentParams: ['id'] })
    // @ts-expect-error — the local route repeats the declared parent param `id`
    .get('/:id', { handler: () => null })
})

test('a duplicate introduced by mounting is a cursor error', () => {
  const first = createRouter('/x').get('/', { handler: () => null })
  const second = createRouter('/x').get('/', { handler: () => null })

  createServer()
    .mount(first)
    // @ts-expect-error — mounting would duplicate GET /x
    .mount(second)
})

test('a duplicate introduced by registering a route plugin is a cursor error', () => {
  const plugin = defineRoute({
    route: '/x',
    get: { handler: () => null },
  })

  createServer()
    .get('/x', { handler: () => null })
    // @ts-expect-error — registering would duplicate GET /x
    .register(plugin)
})

test('the shared Orchard app remains fully typed through the client', async () => {
  const api = createClient<App>({ baseURL: 'x' })
  expectTypeOf(await api.get('/fruits/:id', { params: { id: 'mango' } }).orThrow())
    .toEqualTypeOf<Fruit>()
})
