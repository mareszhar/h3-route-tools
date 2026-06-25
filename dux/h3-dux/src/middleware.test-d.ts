import type { NewFruit } from '@test'
import { createRouter, createServer, defineMiddleware } from '@mszr/h3-dux'
import { NewFruitSchema } from '@test'
import { expectTypeOf, test } from 'vitest'

const withSession = defineMiddleware({ bindings: () => ({ session: { tenant: 'acme' } }) })
const withUser = defineMiddleware({
  requires: [withSession],
  staged: e => ({ token: e.bindings.session.tenant }),
  bindings: e => ({ user: { id: e.staged.token } }),
})

test('a .use binding is typed on event.bindings downstream', () => {
  createServer().use(withSession).get('/x', {
    handler: (e) => {
      expectTypeOf(e.bindings.session).toEqualTypeOf<{ tenant: string }>()
      return null
    },
  })
})

test('requires types the incoming bindings; staged and published bindings compose', () => {
  createServer().use(withSession).use(withUser).get('/me', {
    handler: (e) => {
      expectTypeOf(e.bindings.session).toEqualTypeOf<{ tenant: string }>()
      expectTypeOf(e.bindings.user).toEqualTypeOf<{ id: string }>()
      return null
    },
  })
})

test('a middleware cannot be registered before its requirements are available', () => {
  // @ts-expect-error — withUser requires withSession first
  createServer().use(withUser)

  createRouter()
    // @ts-expect-error — withUser requires withSession first
    .use(withUser)
})

test('two providers of the same binding key collide at the cursor', () => {
  const a = defineMiddleware({ bindings: () => ({ user: { id: 'a' } }) })
  const b = defineMiddleware({ bindings: () => ({ user: { id: 'b' } }) })
  createServer()
    .use(a)
    // @ts-expect-error — `user` is already provided by an earlier middleware
    .use(b)
})

test('an inline .use object publishes typed bindings and sees the chain', () => {
  createServer().use(withSession).use({
    bindings: e => ({ requestId: `${e.bindings.session.tenant}-1` }),
  }).get('/x', {
    handler: (e) => {
      expectTypeOf(e.bindings.requestId).toEqualTypeOf<string>()
      return null
    },
  })
})

test('inline requirements and binding collisions are checked', () => {
  createServer()
    // @ts-expect-error — the inline middleware requires withSession
    .use({ requires: [withSession], bindings: () => ({ requestId: 'x' }) })

  const chained = createServer().use(withSession)
  // @ts-expect-error — `session` is already provided; a second provider can't republish it
  chained.use({ bindings: () => ({ session: { tenant: 'other' } }) })
})

test('endpoint middleware publishes its bindings to that handler only', () => {
  const withUpload = defineMiddleware({ bindings: () => ({ upload: { size: 0 } }) })
  createServer().post('/avatar', {
    middleware: [withUpload],
    handler: (e) => {
      expectTypeOf(e.bindings.upload).toEqualTypeOf<{ size: number }>()
      return null
    },
  })
})

test('endpoint middleware requirements and collisions are checked in execution order', () => {
  const duplicateSession = defineMiddleware({ bindings: () => ({ session: { tenant: 'other' } }) })

  createServer().get('/missing', {
    // @ts-expect-error — withUser requires withSession before it
    middleware: [withUser],
    handler: () => null,
  })

  createServer().get('/ordered', {
    middleware: [withSession, withUser],
    handler: e => e.bindings.user,
  })

  createServer().get('/duplicate', {
    // @ts-expect-error — both providers publish `session`
    middleware: [withSession, duplicateSession],
    handler: () => null,
  })
})

test('endpoint requires must already be supplied by the enclosing chain', () => {
  createServer().get('/missing', {
    // @ts-expect-error — requires consumes a capability; it does not register withSession
    requires: [withSession],
    handler: () => null,
  })

  createServer().use(withSession).get('/present', {
    requires: [withSession],
    handler: e => e.bindings.session,
  })
})

test('a router .requires types its handlers and is checked at mount', () => {
  const account = createRouter('/account')
    .requires(withSession)
    .get('/me', {
      handler: (e) => {
        expectTypeOf(e.bindings.session).toEqualTypeOf<{ tenant: string }>()
        return null
      },
    })

  // Satisfied: the parent provides withSession before mounting.
  createServer().use(withSession).mount(account)

  // @ts-expect-error — the server never provided withSession the router requires
  createServer().mount(account)
})

test('manual mode keeps the direct body raw; eager exposes the validated output', () => {
  createServer().post('/eager', {
    validate: { body: NewFruitSchema },
    handler: (e) => {
      expectTypeOf(e.body).toEqualTypeOf<NewFruit>()
      return null
    },
  })
  createServer().post('/manual', {
    validate: { body: NewFruitSchema, eager: false },
    handler: (e) => {
      expectTypeOf(e.body).toEqualTypeOf<unknown>()
      return null
    },
  })
})
