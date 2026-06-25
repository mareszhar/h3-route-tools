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
