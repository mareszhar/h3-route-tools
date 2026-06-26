/**
 * The canonical Orchard app fixture — authored with the h3-dux verb surface and
 * shared across every test plane. `App = typeof app` is the single source of
 * truth a `createClient<App>()` reads.
 */
import { createServer, sse } from '@mszr/h3-dux'
import * as v from 'valibot'
import { createOrchard } from './orchard.ts'
import {
  CheckoutOrderSchema,
  ErrorSchema,
  FruitPatchSchema,
  FruitQuerySchema,
  FruitSchema,
  NewFruitSchema,
  ReceiptSchema,
  RipenTickSchema,
} from './schemas.ts'

const orchard = createOrchard()

export const app = createServer()
  // No options needed → pass the handler directly; the response is INFERRED from it.
  .get('/health', () => ({ status: 'ripe' as const, at: new Date().toISOString() }))
  // Response kinds (delta 10): a string is inferred as text — no marker required.
  .get('/health/text', () => 'ripe')
  .get('/fruits', {
    validate: { query: FruitQuerySchema, response: v.array(FruitSchema) },
    handler: () => orchard.list(),
  })
  .post('/fruits', {
    status: 201,
    validate: { body: NewFruitSchema, response: FruitSchema },
    // Eager mode (default): the validated body is on the neutral accessor.
    handler: e => orchard.create(e.context.body),
  })
  // `:id` is read from the pattern → e.context.params.id is typed `string`.
  .get('/fruits/:id', {
    validate: { response: FruitSchema },
    handler: e => orchard.get(e.context.params.id),
  })
  // A Blob is inferred as binary — the client receives a Blob, with its MIME intact.
  .get('/fruits/:id/label', (e) => {
    const fruit = orchard.get(e.context.params.id)
    return new Blob([new TextEncoder().encode(`${fruit.emoji} ${fruit.name}`)])
  })
  // Typed errors (delta 9): `errors` declares the failure; `e.error(409, …)` throws it
  // type-checked; the client's `error` is discriminated by status.
  .post('/fruits/:id/reserve', {
    errors: { 409: ErrorSchema },
    handler: (e) => {
      if (e.context.params.id === 'taken')
        throw e.error(409, { error: 'conflict', message: 'already reserved' })
      return { id: e.context.params.id, reserved: true as const }
    },
  })
  .patch('/fruits/:id', {
    validate: { body: FruitPatchSchema, response: FruitSchema },
    handler: e => orchard.update(e.context.params.id, e.context.body),
  })
  .delete('/fruits/:id', {
    status: 204,
    handler: (e) => {
      orchard.remove(e.context.params.id)
      return null
    },
  })
  .post('/checkout', {
    validate: { body: CheckoutOrderSchema, response: ReceiptSchema },
    handler: e => orchard.checkout(e.context.body),
  })
  // SSE: `sse()` makes the client return an AsyncGenerator<RipenTick>; each yield
  // is validated against RipenTickSchema before it goes out.
  .get('/fruits/:id/ripen', {
    validate: { response: sse(RipenTickSchema) },
    async* handler(e) {
      for (const tick of orchard.ripen(e.context.params.id))
        yield tick
    },
  })
  // Manual mode: nothing auto-validates — a dry-run never touches the body.
  .post('/import', {
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
      fruits.forEach(fruit => orchard.create(fruit))
      return { ok: true as const, imported: fruits.length }
    },
  })

export type App = typeof app
