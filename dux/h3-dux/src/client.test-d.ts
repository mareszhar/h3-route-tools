import type { H3DuxHTTPError, H3DuxRawResponse, H3DuxTransportError } from '@mszr/h3-dux'
import type { App, ErrorBody, Fruit, NewFruit } from '@test'
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

test('.orThrow() yields the success data, inferred end-to-end', async () => {
  // Inferred from the handler return — never hand-typed.
  expectTypeOf(await api.get('/health').orThrow())
    .toEqualTypeOf<{ status: 'ripe', at: string }>()

  // From a declared response schema.
  expectTypeOf(await api.get('/fruits/:id', { params: { id: 'mango' } }).orThrow())
    .toEqualTypeOf<Fruit>()

  expectTypeOf(await api.get('/fruits', { query: { sort: 'price', limit: 2 } }).orThrow())
    .toEqualTypeOf<Fruit[]>()

  expectTypeOf(await api.post('/fruits', { body: newFruit }).orThrow())
    .toEqualTypeOf<Fruit>()
})

test('the default await is the honest { data, error } result', async () => {
  const { data, error } = await api.get('/fruits/:id', { params: { id: 'm' } })
  // Before narrowing, data is the success body OR undefined.
  expectTypeOf(data).toEqualTypeOf<Fruit | undefined>()
  if (error) {
    // The error channel is a discriminated union, never the success body.
    expectTypeOf(error.kind).toEqualTypeOf<'http' | 'transport'>()
    return
  }
  // Narrowed: a falsy error means data is present.
  expectTypeOf(data).toEqualTypeOf<Fruit>()
})

test('.raw() returns the native typed response', async () => {
  const res = await api.get('/fruits/:id', { params: { id: 'm' } }).raw()
  expectTypeOf(res).toEqualTypeOf<H3DuxRawResponse<Fruit, 'json'>>()
  expectTypeOf(await res.parse()).toEqualTypeOf<Fruit>()
  expectTypeOf(await res.json()).toEqualTypeOf<Fruit>()
})

test('typed errors: a declared status narrows error.data (delta 9)', async () => {
  const { data, error } = await api.post('/fruits/:id/reserve', { params: { id: 'x' } })
  if (error) {
    if (error.kind === 'transport') {
      // The error channel is the real class, not a structural look-alike (honest types).
      expectTypeOf(error).toEqualTypeOf<H3DuxTransportError>()
      return
    }
    // A declared 409 narrows error.data to the ErrorSchema output.
    if (error.status === 409)
      expectTypeOf(error.data).toEqualTypeOf<ErrorBody>()
    return
  }
  expectTypeOf(data).toEqualTypeOf<{ id: string, reserved: true }>()
})

test('typed errors: status narrows the body directly, no kind guard (Elysia ergonomics, kept honest)', async () => {
  const { error } = await api.post('/fruits/:id/reserve', { params: { id: 'x' } })
  // The transport failure stays in the union (honest), yet `status === 409` narrows
  // straight to the declared body — the transport error's status is `undefined`.
  if (error?.status === 409)
    expectTypeOf(error.data).toEqualTypeOf<ErrorBody>()
})

test('typed errors: the auto-422 validation envelope is typed', async () => {
  // POST /fruits validates a body, so 422 is an auto-registered error status.
  const { error } = await api.post('/fruits', { body: newFruit })
  if (error?.kind === 'http' && error.status === 422)
    expectTypeOf(error.data).toMatchTypeOf<{ source: string }>()
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
  expectTypeOf(await api.get(`/fruits/${id}`).orThrow()).toEqualTypeOf<Fruit>()
})

test('transport options are accepted without changing endpoint data types', async () => {
  const controller = new AbortController()
  const data = await api.get('/health', {
    signal: controller.signal,
    timeout: 1000,
    retry: 1,
    querySerializer: 'repeat',
  }).orThrow()
  expectTypeOf(data).toEqualTypeOf<{ status: 'ripe', at: string }>()
})

test('the runtime error instances match the contract error union', () => {
  // The thrown/returned errors are the exported classes.
  expectTypeOf<H3DuxHTTPError>().toMatchTypeOf<{ kind: 'http', status: number, response: Response }>()
  expectTypeOf<H3DuxTransportError>().toMatchTypeOf<{ kind: 'transport' }>()
})
