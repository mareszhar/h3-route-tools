/**
 * The Orchard server, authored with the h3-dux verb surface. Every delta is on
 * display: per-verb authoring, response + param inference, validation modes,
 * typed SSE, and typed errors. `App = typeof app` is the single source of truth.
 */
import { createServer, defineMiddleware, sse } from '@mszr/h3-dux'
import * as v from 'valibot'
import {
  CheckoutSchema,
  createOrchard,
  ErrorSchema,
  FruitSchema,
  NewFruitSchema,
  NotFoundError,
  ReceiptSchema,
  RipenTickSchema,
} from './orchard.ts'

const orchard = createOrchard()

export const app = createServer()
  // Middleware — chainable via .use(). `defineMiddleware` is the smallest typed
  // form; this one publishes nothing. (Logs to stderr so it stays out of stdout.)
  .use(defineMiddleware((e, next) => {
    console.error(`  [orchard] ${e.req.method} ${new URL(e.req.url).pathname}`)
    return next()
  }))
  // Response inferred from the return — no schema, no annotation.
  .get('/health', { handler: () => ({ status: 'ripe' as const, at: new Date().toISOString() }) })
  // Response kinds (delta 10): strings infer as text — no marker or schema.
  .get('/motd', { handler: () => 'Eat your fruits 🍎' })
  .get('/fruits', { validate: { response: v.array(FruitSchema) }, handler: () => orchard.list() })
  // status sets the success code; the validated body is on e.context.body.
  .post('/fruits', {
    status: 201,
    validate: { body: NewFruitSchema, response: FruitSchema },
    handler: e => orchard.create(e.context.body),
  })
  // `:id` typed from the pattern; `errors` declares a typed 404, thrown with the
  // cursor-checked `e.error(404, …)` — the client's `error` is discriminated by status.
  .get('/fruits/:id', {
    validate: { response: FruitSchema },
    errors: { 404: ErrorSchema },
    handler: (e) => {
      try {
        return orchard.get(e.context.params.id)
      }
      catch (cause) {
        if (cause instanceof NotFoundError)
          throw e.error(404, { error: 'not_found', message: cause.message })
        throw cause
      }
    },
  })
  // Blob → inferred binary download; the client receives a Blob.
  .get('/fruits/:id/label', {
    handler: (e) => {
      const fruit = orchard.get(e.context.params.id)
      return new Blob([new TextEncoder().encode(`${fruit.emoji} ${fruit.name} — $${fruit.pricePerKg}/kg`)])
    },
  })
  // status 204 → the empty kind; the client's `data` is `undefined`, no body to parse.
  .delete('/fruits/:id', {
    status: 204,
    handler: (e) => {
      orchard.remove(e.context.params.id)
      return null
    },
  })
  .post('/checkout', {
    validate: { body: CheckoutSchema, response: ReceiptSchema },
    handler: e => orchard.checkout(e.context.body),
  })
  // Typed SSE: the client receives an AsyncGenerator<RipenTick>.
  .get('/fruits/:id/ripen', {
    validate: { response: sse(RipenTickSchema) },
    async* handler(e) {
      for (const tick of orchard.ripen(e.context.params.id))
        yield tick
    },
  })
  // Manual validation: a dry-run never touches the body.
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
