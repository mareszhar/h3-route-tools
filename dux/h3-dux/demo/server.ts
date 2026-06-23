/**
 * The Orchard server, authored with the h3-dux verb surface. Every delta is on
 * display: per-verb authoring, response + param inference, validation modes, and
 * typed SSE. `App = typeof app` is the single source of truth the client reads.
 */
import { createServer, sse } from '@mszr/h3-dux'
import * as v from 'valibot'
import {
  CheckoutSchema,
  createOrchard,
  FruitSchema,
  NewFruitSchema,
  ReceiptSchema,
  RipenTickSchema,
} from './orchard.ts'

const orchard = createOrchard()

export const app = createServer()
  // Plain h3 middleware — chainable via .use(). (Logs to stderr so it stays out
  // of the trip's stdout.)
  .use((event, next) => {
    console.error(`  [orchard] ${event.req.method} ${new URL(event.req.url).pathname}`)
    return next()
  })
  // Response inferred from the return — no schema, no annotation.
  .get('/health', { handler: () => ({ status: 'ripe' as const, at: new Date().toISOString() }) })
  .get('/fruits', { validate: { response: v.array(FruitSchema) }, handler: () => orchard.list() })
  // status sets the success code; the validated body is on e.context.body.
  .post('/fruits', {
    status: 201,
    validate: { body: NewFruitSchema, response: FruitSchema },
    handler: e => orchard.create(e.context.body),
  })
  // `:id` typed from the pattern — no params schema needed.
  .get('/fruits/:id', { validate: { response: FruitSchema }, handler: e => orchard.get(e.context.params.id) })
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
