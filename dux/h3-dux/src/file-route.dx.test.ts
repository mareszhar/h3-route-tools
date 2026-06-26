import type { Diagnostic } from '@mszr/selenita'
import { cursor } from '@mszr/selenita'
import { duxProject } from '@test'
import { describe, expect, it } from 'vitest'

const project = duxProject()

/** Schema/kernel internals a file-route diagnostic must never leak (delta 6 bar). */
const LEAK = /ObjectSchema|SchemaWithPipe|H3DuxEndpoint\b|H3DuxFileHandler|No overload|Overload \d/

function expectNoLeak(messages: Array<Diagnostic | string>): void {
  for (const m of messages)
    expect(typeof m === 'string' ? m : m.message).not.toMatch(LEAK)
}

describe('file routes — editor DX', () => {
  it('a flat def completes the request contract fields', () => {
    const { completions } = project.query`
      import { defineFileRoute } from '@mszr/h3-dux'
      defineFileRoute({
        ${cursor}
        handler: () => null,
      })
    `
    expect(completions).toContainCompletions(['validate', 'status', 'errors', 'params', 'middleware', 'meta'])
  })

  it('a flat handler event completes the dux accessors', () => {
    const { completions } = project.query`
      import { defineFileRoute } from '@mszr/h3-dux'
      defineFileRoute({
        handler: (e) => {
          e.${cursor}
          return null
        },
      })
    `
    expect(completions).toContainCompletions(['params', 'query', 'body', 'bindings', 'valid', 'error'])
  })

  it('a factory completes use, requires, and compose', () => {
    const { completions } = project.query`
      import { createFileRouteFactory } from '@mszr/h3-dux'
      createFileRouteFactory().${cursor}
    `
    expect(completions).toContainCompletions(['use', 'requires', 'compose'])
  })

  it('a clean flat route raises no diagnostics', () => {
    const { errors } = project.check`
      import { defineFileRoute } from '@mszr/h3-dux'
      void defineFileRoute({
        status: 201,
        handler: e => ({ id: e.params.id }),
      })
    `
    expect(errors).toBeClean()
  })

  it('a clean method map raises no diagnostics', () => {
    const { errors } = project.check`
      import { defineFileRoute } from '@mszr/h3-dux'
      import * as v from 'valibot'
      void defineFileRoute({
        params: v.object({ id: v.string() }),
        get: { handler: e => ({ id: e.params.id }) },
        delete: { status: 204, handler: () => null },
      })
    `
    expect(errors).toBeClean()
  })

  it('a malformed flat route reports an excess key instead of disappearing into an empty method map', () => {
    const { errors } = project.check`
      import { defineFileRoute } from '@mszr/h3-dux'
      void defineFileRoute({
        statuz: 201,
        handler: () => null,
      })
    `
    expect(errors).toHaveErrorCount(1)
    expect(errors).toHaveError(/statuz/)
    expectNoLeak(errors)
  })

  it('a malformed flat response reports the handler return instead of disappearing into an empty method map', () => {
    const { errors } = project.check`
      import { defineFileRoute } from '@mszr/h3-dux'
      import * as v from 'valibot'
      void defineFileRoute({
        validate: { response: v.object({ ok: v.boolean() }) },
        handler: () => ({ ok: 'yes' }),
      })
    `
    expect(errors).toHaveErrorCount(1)
    expect(errors).toHaveError(2322, /string.*never/)
    expectNoLeak(errors)
  })

  it('a typo method key reports the unknown key instead of becoming an empty method map', () => {
    const { errors } = project.check`
      import { defineFileRoute } from '@mszr/h3-dux'
      void defineFileRoute({
        gett: { handler: () => null },
      })
    `
    expect(errors).toHaveErrorCount(1)
    expect(errors).toHaveError(/gett/)
    expectNoLeak(errors)
  })

  it('calling a factory with open requirements errors, with no schema leak', () => {
    const { errors } = project.check`
      import { createFileRouteFactory, defineMiddleware } from '@mszr/h3-dux'
      const withDatabase = defineMiddleware({ bindings: () => ({ database: { name: 'x' } }) })
      const feature = createFileRouteFactory().requires(withDatabase)
      void feature({ handler: () => null })
    `
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors).toHaveError(/not callable/i)
    expectNoLeak(errors)
  })

  it('composing a factory that does not satisfy a requirement errors at the cursor', () => {
    const { errors } = project.check`
      import { createFileRouteFactory, defineMiddleware } from '@mszr/h3-dux'
      const withDatabase = defineMiddleware({ bindings: () => ({ database: { name: 'x' } }) })
      const withStore = defineMiddleware({ requires: [withDatabase], bindings: () => ({ store: 's' }) })
      const feature = createFileRouteFactory().requires(withDatabase).use(withStore)
      void createFileRouteFactory().compose(feature)
    `
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors).toHaveError(/required binding/)
    expectNoLeak(errors)
  })
})
