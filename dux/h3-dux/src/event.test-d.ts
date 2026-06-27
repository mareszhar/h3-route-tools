import type { H3DuxEvent } from '@mszr/h3-dux'
import type { H3Event } from 'h3'
import { createFileRouteFactory, createRouter, createServer, defineFileRoute, defineMiddleware } from '@mszr/h3-dux'
import * as v from 'valibot'
import { expectTypeOf, test } from 'vitest'

/**
 * `H3DuxEvent` is the route-agnostic handler event — the type a userland utility
 * annotates to accept *any* handler's `event`, the way plain-h3 utils take
 * `H3Event`. No hand-rolled interface. The contract: every per-route handler event
 * (standalone, router, file route — any error/param/body/validation shape) is
 * assignable to it, and `e.error`/`e.req`/`e.bindings` are usable from the util.
 */

// The kind of utilities the demos previously had to hand-roll an interface for.
function requireKey(e: H3DuxEvent): void {
  if (!e.req.headers.get('x-key'))
    throw e.error(401, { error: 'unauthorized' })
}
function rethrow(e: H3DuxEvent, cause: unknown): never {
  throw e.error(500, { cause: String(cause) })
}

function readNativeRequest(e: H3Event): string | null {
  return e.req.headers.get('authorization')
}

type EventWithParams = Omit<H3Event, 'context'> & {
  context: Omit<H3Event['context'], 'params'> & {
    params?: Record<string, unknown>
  }
}

function readSharedParam(e: EventWithParams): unknown {
  return e.context.params?.id
}

test('a H3DuxEvent util accepts every standalone handler shape', () => {
  createServer()
    // no declared errors, inferred response
    .get('/health', (e) => {
      requireKey(e)
      readNativeRequest(e)
      return { ok: true }
    })
    // declared errors + params inferred from the pattern
    .get('/fruits/:id', {
      errors: { 404: v.object({ error: v.string() }) },
      handler: (e) => {
        requireKey(e)
        return { id: e.context.params.id }
      },
    })
    // body + status + multiple declared errors
    .post('/fruits', {
      status: 201,
      validate: { body: v.object({ name: v.string() }) },
      errors: { 401: v.object({ error: v.string() }), 409: v.object({ error: v.string() }) },
      handler: (e) => {
        try {
          requireKey(e)
          return { id: e.context.body.name }
        }
        catch (cause) {
          rethrow(e, cause)
        }
      },
    })
    // a params SCHEMA that coerces `:id` to a number
    .get('/n/:id', {
      params: v.object({ id: v.pipe(v.string(), v.transform(Number)) }),
      handler: (e) => {
        requireKey(e)
        readSharedParam(e)
        return { id: e.context.params.id }
      },
    })
    // manual validation mode
    .post('/import', {
      validate: { body: v.array(v.object({ name: v.string() })), eager: false },
      handler: (e) => {
        requireKey(e)
        return { ok: true }
      },
    })
})

test('shared h3 / h3-dux utilities can widen only context.params', () => {
  const event = undefined as unknown as H3Event
  readSharedParam(event)
})

test('a H3DuxEvent util accepts router and file-route handler events', () => {
  createRouter('/fruits').get('/:id', (e) => {
    requireKey(e)
    return { id: e.context.params.id }
  })

  defineFileRoute({
    post: {
      validate: { body: v.object({ name: v.string() }) },
      errors: { 401: v.object({ error: v.string() }) },
      handler: (e) => {
        requireKey(e)
        return { id: e.context.body.name }
      },
    },
  })

  // Capability-carrying file-route factories produce assignable events too.
  const factory = createFileRouteFactory()
  factory((e) => {
    requireKey(e)
    return { ok: true }
  })
})

test('H3DuxEvent<Bindings> types a util that depends on a middleware capability', () => {
  interface User { id: string, role: 'admin' | 'user' }

  function requireAdmin(e: H3DuxEvent<{ user: User }>): User {
    // `e.bindings.user` is fully typed from the parameter.
    expectTypeOf(e.bindings.user).toEqualTypeOf<User>()
    if (e.bindings.user.role !== 'admin')
      throw e.error(403, { error: 'forbidden' })
    return e.bindings.user
  }

  const auth = defineMiddleware({
    bindings: () => ({ user: { id: '1', role: 'admin' as const } satisfies User }),
    handler: (e, next) => next(),
  })

  createServer().use(auth).get('/me', (e) => {
    const user = requireAdmin(e)
    return { id: user.id }
  })
})
