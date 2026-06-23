import type { App, Fruit, NewFruit } from '@test'
import { createClient } from '@mszr/h3-dux'
import { expectTypeOf, test } from 'vitest'

const api = createClient<App>({ baseURL: '' })

const newFruit: NewFruit = {
  name: 'Lychee',
  emoji: '🫐',
  color: 'pink',
  tags: ['sweet'],
  pricePerKg: 12,
  stockKg: 3,
}

test('verb sugar infers the wire response from the server contract', async () => {
  // Inferred from the handler return — never hand-typed.
  expectTypeOf(await (await api.get('/health')).json())
    .toEqualTypeOf<{ status: 'ripe', at: string }>()

  // From a declared response schema.
  expectTypeOf(await (await api.get('/fruits/:id', { params: { id: 'mango' } })).json())
    .toEqualTypeOf<Fruit>()

  expectTypeOf(await (await api.get('/fruits', { query: { sort: 'price', limit: 2 } })).json())
    .toEqualTypeOf<Fruit[]>()

  expectTypeOf(await (await api.post('/fruits', { body: newFruit })).json())
    .toEqualTypeOf<Fruit>()
})

test('verb sugar is exactly the bare call with the method baked in', async () => {
  const viaVerb = await (await api.get('/fruits/:id', { params: { id: 'm' } })).json()
  const viaBare = await (await api('/fruits/:id', { method: 'get', params: { id: 'm' } })).json()
  expectTypeOf(viaVerb).toEqualTypeOf(viaBare)
})

test('verb sugar rejects undeclared verbs, routes, and excess options', () => {
  // @ts-expect-error — /health declares no POST
  void api.post('/health', { body: newFruit })
  // @ts-expect-error — unknown route
  void api.get('/nope')
  // @ts-expect-error — /health takes no body
  void api.get('/health', { body: newFruit })
  // @ts-expect-error — /fruits/:id requires params
  void api.get('/fruits/:id')
})

test('path interpolation resolves the endpoint, no params option needed', async () => {
  const id = 'mango'
  expectTypeOf(await (await api.get(`/fruits/${id}`)).json()).toEqualTypeOf<Fruit>()

  // Interpolated and keyed forms are the same call.
  const keyed = await (await api.get('/fruits/:id', { params: { id } })).json()
  expectTypeOf(await (await api.get(`/fruits/${id}`)).json()).toEqualTypeOf(keyed)
})

test('interpolation rejects a path no route declares', () => {
  const x = 'x'
  // @ts-expect-error — there is no /nope/:x route
  void api.get(`/nope/${x}`)
})
