import type { FileMethods, FlatContract, WithFilenameParams } from '@mszr/h3-dux'
/**
 * Nitro file routes (delta 13) — type plane. The flat and method-map forms infer
 * the same kernel as the standalone builder, the handler `event` is typed from the
 * filename-free contract, the factory is callable only when its requirements are
 * met, and a generated-style `Routes` map (filename params applied via
 * `WithFilenameParams`) types a `createClient<Routes>()` end-to-end.
 */
import type { ErrorBody, Fruit, NewFruit } from '@test'
import { createClient, createFileRouteFactory, defineFileRoute, defineMiddleware } from '@mszr/h3-dux'
import { CheckoutOrderSchema, createOrchard, ErrorSchema, FruitSchema, NewFruitSchema } from '@test'
import * as v from 'valibot'
import { expectTypeOf, test } from 'vitest'

const orchard = createOrchard()

test('a flat handler types its event from validate; no schema means Record params', () => {
  defineFileRoute({
    validate: { body: NewFruitSchema },
    handler: (e) => {
      expectTypeOf(e.body).toEqualTypeOf<NewFruit>()
      // Without a params schema, a file route sees Record<string, string> (codegen
      // substitutes the exact filename params).
      expectTypeOf(e.params).toEqualTypeOf<Record<string, string>>()
      return null
    },
  })
})

test('a params schema types the flat handler params', () => {
  defineFileRoute({
    params: v.object({ id: v.pipe(v.string(), v.transform(Number)) }),
    handler: (e) => {
      expectTypeOf(e.params.id).toEqualTypeOf<number>()
      return null
    },
  })
})

test('a method map types each handler from its method def and the shared params', () => {
  defineFileRoute({
    params: v.object({ id: v.string() }),
    get: {
      handler: (e) => {
        expectTypeOf(e.params.id).toEqualTypeOf<string>()
        return orchard.get(e.params.id)
      },
    },
    post: {
      validate: { body: NewFruitSchema },
      handler: (e) => {
        expectTypeOf(e.body).toEqualTypeOf<NewFruit>()
        return orchard.create(e.body)
      },
    },
  })
})

// ── the generated-client round-trip (what `#h3-dux/routes` will produce) ───────

const _checkoutRoute = defineFileRoute({
  status: 201,
  validate: { body: CheckoutOrderSchema, response: v.array(FruitSchema) },
  errors: { 409: ErrorSchema },
  handler: () => orchard.list(),
})

const _fruitRoute = defineFileRoute({
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

// Codegen builds this map from Nitro's path/method table + the handler kernels,
// substituting the filename-derived params. Here we assemble it by hand to prove
// the projection types the client correctly.
interface Routes {
  '/checkout': { post: WithFilenameParams<FlatContract<typeof _checkoutRoute>, object> }
  '/fruits/:id': {
    get: WithFilenameParams<FileMethods<typeof _fruitRoute>['get'], { id: string }>
    delete: WithFilenameParams<FileMethods<typeof _fruitRoute>['delete'], { id: string }>
  }
}

const api = createClient<Routes>({ baseURL: '' })

test('the generated map types the success body, status, and typed errors', async () => {
  expectTypeOf(await api.post('/checkout', { body: { items: [{ id: 'mango', kg: 1 }] } }).orThrow())
    .toEqualTypeOf<Fruit[]>()

  const { error } = await api.post('/checkout', { body: { items: [{ id: 'mango', kg: 1 }] } })
  if (error?.kind === 'http' && error.status === 409)
    expectTypeOf(error.data).toEqualTypeOf<ErrorBody>()
})

test('filename params type the client call; a 204 method yields undefined', async () => {
  expectTypeOf(await api.get('/fruits/:id', { params: { id: 'mango' } }).orThrow())
    .toEqualTypeOf<Fruit>()
  expectTypeOf(await api.delete('/fruits/:id', { params: { id: 'mango' } }).orThrow())
    .toEqualTypeOf<undefined>()
})

// ── factory capabilities ──────────────────────────────────────────────────────

const withRequestId = defineMiddleware({ bindings: () => ({ requestId: 'x' }) })
const withDatabase = defineMiddleware({ bindings: () => ({ database: { name: 'orchard' } }) })
const withStore = defineMiddleware({
  requires: [withDatabase],
  bindings: e => ({ store: `s:${e.bindings.database.name}` }),
})

test('a factory publishes its bindings to handlers it defines', () => {
  const defineAppRoute = createFileRouteFactory().use(withRequestId)
  defineAppRoute({
    handler: (e) => {
      expectTypeOf(e.bindings.requestId).toEqualTypeOf<string>()
      return null
    },
  })
})

test('a factory with open requirements is not callable until composed', () => {
  const storeFeature = createFileRouteFactory().requires(withDatabase).use(withStore)
  // @ts-expect-error — storeFeature requires withDatabase; it is not callable yet
  storeFeature({ handler: () => null })

  const defineStoreRoute = createFileRouteFactory().use(withDatabase).compose(storeFeature)
  defineStoreRoute({
    handler: (e) => {
      expectTypeOf(e.bindings.store).toEqualTypeOf<string>()
      expectTypeOf(e.bindings.database).toEqualTypeOf<{ name: string }>()
      return null
    },
  })
})

test('compose rejects a parent that does not satisfy the feature requirement', () => {
  const storeFeature = createFileRouteFactory().requires(withDatabase).use(withStore)
  // @ts-expect-error — the base factory does not provide withDatabase
  createFileRouteFactory().compose(storeFeature)
})

test('the flat brand carries a single contract; the method map carries per-method', () => {
  // The flat route exposes one contract (its success status); the method map a
  // per-method kernel keyed by the declared methods.
  expectTypeOf<FlatContract<typeof _checkoutRoute>['success']>().toEqualTypeOf<201>()
  expectTypeOf<keyof FileMethods<typeof _fruitRoute>>().toEqualTypeOf<'get' | 'delete'>()
})
