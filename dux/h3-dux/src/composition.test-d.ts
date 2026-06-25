import type { App, Fruit } from '@test'
import { createClient, createRouter, createServer } from '@mszr/h3-dux'
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
  createRouter('/friends', { parentParams: ['userId'] }).get('/:friendId', {
    handler: (e) => {
      expectTypeOf(e.params.userId).toEqualTypeOf<string>()
      expectTypeOf(e.params.friendId).toEqualTypeOf<string>()
      return null
    },
  })
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

test('the shared Orchard app remains fully typed through the client', async () => {
  const api = createClient<App>({ baseURL: 'x' })
  expectTypeOf(await api.get('/fruits/:id', { params: { id: 'mango' } }).orThrow())
    .toEqualTypeOf<Fruit>()
})
