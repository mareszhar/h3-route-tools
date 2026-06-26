import type { Diagnostic } from '@mszr/selenita'
import { duxProject } from '@test'
import { describe, expect, it } from 'vitest'

const project = duxProject()

/** Schema/kernel internals a diagnostic must never leak (delta 6 bar). */
const LEAK = /ObjectSchema|SchemaWithPipe|H3DuxEndpoint\b/

function expectNoLeak(messages: Array<Diagnostic | string>): void {
  for (const m of messages)
    expect(typeof m === 'string' ? m : m.message).not.toMatch(LEAK)
}

describe('bare-handler shorthand — editor DX', () => {
  it('a server verb bare handler raises no diagnostics', () => {
    const { errors } = project.check`
      import { createServer } from '@mszr/h3-dux'
      void createServer().get('/fruits/:id', e => ({ id: e.params.id }))
    `
    expect(errors).toBeClean()
  })

  it('defineFileRoute bare handler raises no diagnostics', () => {
    const { errors } = project.check`
      import { defineFileRoute } from '@mszr/h3-dux'
      export default defineFileRoute(e => ({ ok: true, p: e.params }))
    `
    expect(errors).toBeClean()
  })

  it('the union param keeps a bad options object a single cursor diagnostic — never a "No overload" wall', () => {
    const { errors } = project.check`
      import { createServer } from '@mszr/h3-dux'
      void createServer().get('/x', { handler: () => 1, bogus: 2 })
    `
    // Strategy B (one signature, union param) preserves the delta-6 win: the
    // shorthand never reintroduces the doubled overload wall.
    expect(errors).toHaveError(/bogus/)
    expect(errors).not.toHaveError(/No overload|Overload \d/)
    expect(errors.length).toBe(1)
    expectNoLeak(errors)
  })

  it('a factory bare handler with bindings raises no diagnostics', () => {
    const { errors } = project.check`
      import { createFileRouteFactory, defineMiddleware } from '@mszr/h3-dux'
      const f = createFileRouteFactory().use(defineMiddleware({ bindings: () => ({ rid: 'x' }) }))
      export default f(e => ({ rid: e.bindings.rid }))
    `
    expect(errors).toBeClean()
  })

  it('a bare .use callback types its event/next — no defineMiddleware wrap, no implicit any', () => {
    const { errors } = project.check`
      import { createServer, defineMiddleware } from '@mszr/h3-dux'
      const withSession = defineMiddleware({ bindings: () => ({ tenant: 'acme' }) })
      void createServer()
        .use(withSession)
        .use((e, next) => { void e.bindings.tenant; void e.req.method; return next() })
    `
    expect(errors).toBeClean()
  })
})
