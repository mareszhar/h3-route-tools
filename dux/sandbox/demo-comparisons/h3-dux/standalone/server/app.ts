import type { H3DuxEvent } from '@mszr/h3-dux'
import { createServer, sse } from '@mszr/h3-dux'
import {
  CheckoutOrderSchema,
  createOrchard,
  ErrorSchema,
  FruitPageSchema,
  FruitPatchSchema,
  FruitQuerySchema,
  FruitSchema,
  NewFruitSchema,
  ORCHARD_KEY,
  ORCHARD_KEY_HEADER,
  OrchardError,
  ReceiptSchema,
  RipenTickSchema,
  UnauthorizedError,
} from '@orchard/domain'

const orchard = createOrchard()
const writeKey = process.env.ORCHARD_KEY ?? ORCHARD_KEY

// Utilities that work with any h3-dux handler event just annotate `H3DuxEvent` —
// the same way plain-h3 utils take `H3Event`. No interface to hand-roll.
function toDuxError(e: H3DuxEvent, error: OrchardError): Error {
  return e.error(error.status, error.toBody())
}

function requireKey(e: H3DuxEvent): void {
  if (e.req.headers.get(ORCHARD_KEY_HEADER) !== writeKey)
    throw toDuxError(e, new UnauthorizedError())
}

function rethrowDomain(e: H3DuxEvent, cause: unknown): never {
  if (cause instanceof OrchardError)
    throw toDuxError(e, cause)
  throw cause
}

export const app = createServer()
  .use((e, next) => {
    console.log(`${e.req.method} ${new URL(e.req.url).pathname}`)
    return next()
  })
  .get('/health', () => ({ status: 'ripe' as const, at: new Date().toISOString() }))
  .get('/fruits', {
    validate: { query: FruitQuerySchema, response: FruitPageSchema },
    handler: e => orchard.list(e.context.query),
  })
  .get('/fruits/:id', {
    validate: { response: FruitSchema },
    errors: { 404: ErrorSchema },
    handler: (e) => {
      try {
        return orchard.get(e.context.params.id)
      }
      catch (cause) {
        rethrowDomain(e, cause)
      }
    },
  })
  .post('/fruits', {
    status: 201,
    validate: { body: NewFruitSchema, response: FruitSchema },
    errors: { 401: ErrorSchema, 409: ErrorSchema },
    handler: (e) => {
      try {
        requireKey(e)
        return orchard.create(e.context.body)
      }
      catch (cause) {
        rethrowDomain(e, cause)
      }
    },
  })
  .patch('/fruits/:id', {
    validate: { body: FruitPatchSchema, response: FruitSchema },
    errors: { 401: ErrorSchema, 404: ErrorSchema },
    handler: (e) => {
      try {
        requireKey(e)
        return orchard.update(e.context.params.id, e.context.body)
      }
      catch (cause) {
        rethrowDomain(e, cause)
      }
    },
  })
  .delete('/fruits/:id', {
    status: 204,
    errors: { 401: ErrorSchema, 404: ErrorSchema },
    handler: (e) => {
      try {
        requireKey(e)
        orchard.remove(e.context.params.id)
        return null
      }
      catch (cause) {
        rethrowDomain(e, cause)
      }
    },
  })
  .post('/checkout', {
    validate: { body: CheckoutOrderSchema, response: ReceiptSchema },
    errors: { 404: ErrorSchema, 409: ErrorSchema },
    handler: (e) => {
      try {
        return orchard.checkout(e.context.body)
      }
      catch (cause) {
        rethrowDomain(e, cause)
      }
    },
  })
  .get('/fruits/:id/ripen', {
    validate: { response: sse(RipenTickSchema) },
    errors: { 404: ErrorSchema },
    async* handler(e) {
      try {
        for await (const tick of orchard.ripen(e.context.params.id))
          yield tick
      }
      catch (cause) {
        rethrowDomain(e, cause)
      }
    },
  })

export type App = typeof app
