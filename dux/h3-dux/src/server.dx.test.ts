import { cursor } from '@mszr/selenita'
import { duxProject } from '@test'
import { describe, expect, it } from 'vitest'

const project = duxProject()

describe('server verb authoring — editor DX', () => {
  it('the server offers verb methods and use()', () => {
    const { completions } = project.query`
      import { createServer } from '@mszr/h3-dux'
      createServer().${cursor}
    `
    expect(completions).toContainCompletions(['get', 'post', 'put', 'patch', 'delete', 'use'])
  })

  it('params inferred from the pattern complete inside the handler', () => {
    const { completions } = project.query`
      import { createServer } from '@mszr/h3-dux'
      createServer().get('/fruits/:id', {
        handler: (e) => {
          e.context.params.${cursor}
          return null
        },
      })
    `
    expect(completions).toContainCompletions(['id'])
  })

  it('validated body and params hover as plain shapes, no schema internals', () => {
    const r = project.query`
      import { createServer } from '@mszr/h3-dux'
      import * as v from 'valibot'
      createServer().post('/fruits/:id', {
        validate: { body: v.object({ name: v.string(), price: v.number() }) },
        handler: (e) => {
          const b = e.context.b${cursor}ody
          return { id: e.context.params.id, b }
        },
      })
    `
    expect(r.hover).toMatch(/name: string/)
    expect(r.hover).toMatch(/price: number/)
    expect(r.hover).not.toMatch(/ObjectSchema|StringSchema|SchemaWithPipe/)
  })
})

/**
 * Server diagnostics are a contract too (delta 6, dux-vision.md principle 3). A bad
 * authoring choice must report a single, actionable message at the cursor — the fix,
 * not a schema graph or a cryptic "not assignable to undefined/never".
 */
describe('server diagnostics are a contract', () => {
  it('a body on a bodyless verb names the fix', () => {
    const { errors } = project.check`
      import { createServer } from '@mszr/h3-dux'
      import * as v from 'valibot'
      createServer().get('/x', {
        validate: { body: v.object({ a: v.string() }) },
        handler: () => ({ ok: true }),
      })
    `
    expect(errors).toHaveError(/remove validate\.body/)
    expect(errors.map(e => e.message).join('\n')).not.toMatch(/not assignable to type 'undefined'/)
  })

  it('a duplicate route + method names the duplicate, not the route map', () => {
    const { errors } = project.check`
      import { createServer } from '@mszr/h3-dux'
      createServer()
        .get('/fruits', () => ({ ok: true }))
        .get('/fruits', () => ({ ok: false }))
    `
    expect(errors).toHaveError(/already defined/)
    expect(errors.map(e => e.message).join('\n')).not.toMatch(/MergePair|H3DuxRouteRecord|ObjectSchema/)
  })

  it('an undeclared error status is rejected at e.error', () => {
    const { errors } = project.check`
      import { createServer } from '@mszr/h3-dux'
      import * as v from 'valibot'
      createServer().post('/x/:id', {
        errors: { 409: v.object({ error: v.string() }) },
        handler: e => e.error(404, { error: 'nope' }),
      })
    `
    expect(errors).toHaveError(/'404' is not assignable to parameter of type '409'/)
  })
})
