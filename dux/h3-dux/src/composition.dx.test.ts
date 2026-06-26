import type { Diagnostic } from '@mszr/selenita'
import { cursor } from '@mszr/selenita'
import { duxProject } from '@test'
import { describe, expect, it } from 'vitest'

const project = duxProject()

/**
 * Schema internals a composition diagnostic must never leak (delta 6 bar). A
 * `.mount` requirement failure is an instance-assignability error, so TS echoes
 * the router's route map — but with *resolved* members (`{ id: string }`), never
 * the valibot schema generics this guard forbids.
 */
const LEAK = /ObjectSchema|SchemaWithPipe|H3DuxEndpoint\b/

function expectNoLeak(messages: Array<Diagnostic | string>): void {
  for (const m of messages)
    expect(typeof m === 'string' ? m : m.message).not.toMatch(LEAK)
}

describe('delta-aware composition — editor DX', () => {
  it('a router offers the same verb surface as a server, plus mount-side helpers', () => {
    const { completions } = project.query`
      import { createRouter } from '@mszr/h3-dux'
      createRouter('/fruits').${cursor}
    `
    expect(completions).toContainCompletions(['get', 'post', 'put', 'patch', 'delete', 'use', 'requires'])
    expect(completions).not.toContainCompletions(['entries', 'middlewares', 'parentParams'])
  })

  it('the server exposes mount, register, and the native escape hatch', () => {
    const { completions } = project.query`
      import { createServer } from '@mszr/h3-dux'
      const app = createServer()
      app.${cursor}
    `
    expect(completions).toContainCompletions(['mount', 'register', 'native', 'use', 'get'])
  })

  it('a router prefix param completes inside a child handler', () => {
    const { completions } = project.query`
      import { createRouter } from '@mszr/h3-dux'
      createRouter('/users/:userId/friends').get('/:friendId', {
        handler: (e) => {
          e.params.${cursor}
          return null
        },
      })
    `
    expect(completions).toContainCompletions(['userId', 'friendId'])
  })

  it('a clean router → mount → client round-trip raises no diagnostics', () => {
    const { errors } = project.check`
      import { createRouter, createServer } from '@mszr/h3-dux'
      const fruits = createRouter('/fruits').get('/:id', { handler: e => ({ id: e.params.id }) })
      void createServer().mount(fruits)
    `
    expect(errors).toBeClean()
  })

  it('mounting a router that requires an unprovided binding errors at the cursor', () => {
    const { errors } = project.check`
      import { createRouter, createServer, defineMiddleware } from '@mszr/h3-dux'
      const withUser = defineMiddleware({ bindings: () => ({ user: { id: 'u1' } }) })
      const account = createRouter('/account').requires(withUser).get('/me', { handler: e => e.bindings.user })
      void createServer().mount(account)
    `
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors).toHaveError(/required binding/)
    expectNoLeak(errors)
  })

  it('a duplicate route + method is reported with a guiding message', () => {
    const { errors } = project.check`
      import { createServer } from '@mszr/h3-dux'
      void createServer()
        .get('/x', { handler: () => null })
        .get('/x', { handler: () => null })
    `
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors).toHaveError(/already defined/)
    expectNoLeak(errors)
  })

  it('an invalid parentParams mount names the param mismatch', () => {
    const { errors } = project.check`
      import { createRouter, createServer } from '@mszr/h3-dux'
      const friends = createRouter('/friends', { parentParams: ['userId'] })
        .get('/:friendId', { handler: e => e.params.userId })
      void createServer().mount('/orgs/:orgId', friends)
    `
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors).toHaveError(/parentParams/)
    expectNoLeak(errors)
  })
})
