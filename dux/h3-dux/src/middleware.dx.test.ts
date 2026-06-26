import type { Diagnostic } from '@mszr/selenita'
import { cursor } from '@mszr/selenita'
import { duxProject } from '@test'
import { describe, expect, it } from 'vitest'

const project = duxProject()

/**
 * Schema/endpoint internals a middleware diagnostic must never leak (delta 6 bar).
 * `.use` is legitimately multi-form (typed middleware, inline object, plain fn),
 * so a binding collision surfaces overload framing — honest, not schema soup.
 */
const LEAK = /ObjectSchema|SchemaWithPipe|H3DuxEndpoint/

function expectNoLeak(messages: Array<Diagnostic | string>): void {
  for (const m of messages)
    expect(typeof m === 'string' ? m : m.message).not.toMatch(LEAK)
}

describe('typed middleware bindings — editor DX', () => {
  it('event.bindings completes the published capabilities in a handler', () => {
    const { completions } = project.query`
      import { createServer, defineMiddleware } from '@mszr/h3-dux'
      const withUser = defineMiddleware({ bindings: () => ({ user: { id: 'u1' } }) })
      createServer().use(withUser).get('/me', {
        handler: (e) => {
          e.bindings.${cursor}
          return null
        },
      })
    `
    expect(completions).toContainCompletions(['user'])
  })

  it('event.staged completes inside the middleware that prepared it', () => {
    const { completions } = project.query`
      import { defineMiddleware } from '@mszr/h3-dux'
      defineMiddleware({
        staged: () => ({ token: 'abc' }),
        bindings: (e) => {
          e.staged.${cursor}
          return { user: 1 }
        },
      })
    `
    expect(completions).toContainCompletions(['token'])
  })

  it('a clean middleware chain raises no diagnostics', () => {
    const { errors } = project.check`
      import { createServer, defineMiddleware } from '@mszr/h3-dux'
      const withSession = defineMiddleware({ bindings: () => ({ session: { tenant: 'acme' } }) })
      const withUser = defineMiddleware({
        requires: [withSession],
        bindings: e => ({ user: { id: e.bindings.session.tenant } }),
      })
      void createServer().use(withSession).use(withUser).get('/me', { handler: e => e.bindings.user })
    `
    expect(errors).toBeClean()
  })

  it('a provider registered before its requirement reports the missing capability', () => {
    const { errors } = project.check`
      import { createServer, defineMiddleware } from '@mszr/h3-dux'
      const withSession = defineMiddleware({ bindings: () => ({ session: { id: 's1' } }) })
      const withUser = defineMiddleware({
        requires: [withSession],
        bindings: e => ({ user: e.bindings.session.id }),
      })
      void createServer().use(withUser)
    `
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors).toHaveError(/requires bindings/)
    expectNoLeak(errors)
  })

  it('two providers of the same binding key collide without leaking internals', () => {
    const { errors } = project.check`
      import { createServer, defineMiddleware } from '@mszr/h3-dux'
      const a = defineMiddleware({ bindings: () => ({ user: { id: 'a' } }) })
      const b = defineMiddleware({ bindings: () => ({ user: { id: 'b' } }) })
      void createServer().use(a).use(b)
    `
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors).toHaveError(/already provided/)
    expectNoLeak(errors)
  })

  it('a plain (event, next) middleware stays accepted and untyped', () => {
    const { errors } = project.check`
      import { createServer, defineMiddleware } from '@mszr/h3-dux'
      const logger = defineMiddleware((e, next) => next())
      void createServer().use(logger).get('/x', { handler: () => null })
    `
    expect(errors).toBeClean()
  })

  it('the event surface exposes the first-class root accessors', () => {
    const { completions } = project.query`
      import { createServer } from '@mszr/h3-dux'
      createServer().post('/x', {
        handler: (e) => {
          e.${cursor}
          return null
        },
      })
    `
    expect(completions).toContainCompletions(['params', 'query', 'body', 'bindings', 'valid', 'error', 'context'])
  })
})
