import type { Diagnostic } from '@mszr/selenita'
import { cursor } from '@mszr/selenita'
import { duxProject } from '@test'
import { describe, expect, it } from 'vitest'

const project = duxProject()

const setup = `
  import { createClient } from '@mszr/h3-dux'
  import type { App } from '@test'
  const api = createClient<App>()
`

/**
 * The leak guard: none of these may appear in a verb-call diagnostic. They are
 * the schema/endpoint/overload internals that made the Generation-1 message a
 * wall of noise — the whole point of delta 6 is that the user never sees them.
 */
const LEAK = /ObjectSchema|SchemaWithPipe|RegexAction|DuxEndpoint|QueryHeaderOption|MergePair|DuxRouteRecord|NoExcess|No overload|Overload \d/

function expectNoLeak(messages: Array<Diagnostic | string>): void {
  for (const m of messages)
    expect(typeof m === 'string' ? m : m.message).not.toMatch(LEAK)
}

describe('client verb sugar — editor DX', () => {
  it('the client offers symmetric verb methods', () => {
    const { completions } = project.query`
      ${setup}
      api.${cursor}
    `
    expect(completions).toContainCompletions(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
  })

  it('a verb completes the routes that declare it — including :param patterns', () => {
    const { completions } = project.query`
      ${setup}
      api.get('${cursor}')
    `
    // The interpolation forms must not subsume the :param literals out of the dropdown.
    expect(completions).toContainCompletions(['/health', '/fruits', '/fruits/:id', '/fruits/:id/ripen'])
  })

  it('a verb offers only the routes that declare it', () => {
    const { completions } = project.query`
      ${setup}
      api.post('${cursor}')
    `
    expect(completions).toEqualCompletions(['/fruits', '/checkout', '/import'])
  })

  it('inside the body literal, the fields autocomplete with plain types', () => {
    const r = project.query`
      ${setup}
      api.post('/fruits', { body: { ${cursor} } })
    `
    expect(r.completions).toContainCompletions(['name', 'emoji', 'pricePerKg', 'stockKg'])
    expect(r.completionItem('name')).toHaveType('(property) name: string')
    expect(r.completionItem('pricePerKg')).toHaveType('(property) pricePerKg: number')
  })
})

/**
 * Diagnostics-as-contract (delta 6). Each verb-call mistake must produce a single,
 * actionable, leak-free diagnostic — asserted, not assumed. These are the tests
 * that would have caught the Generation-1 regression the bar slipped on.
 */
describe('diagnostics are a contract', () => {
  it('a correct call is clean', () => {
    const r = project.check`
      ${setup}
      void api.post('/fruits', { body: { name: 'x', emoji: '🥝', color: 'pink', tags: ['sweet'], pricePerKg: 1, stockKg: 1 } })
    `
    expect(r.errors).toBeClean()
  })

  it('a missing body field → one diagnostic that names the field and says missing', () => {
    const { errors } = project.check`
      ${setup}
      api.post('/fruits', { body: { name: 'x', emoji: '🥝', pricePerKg: 1 } })
    `
    expect(errors).toHaveErrorCount(1) // not the doubled "Overload 1 of 2 / 2 of 2"
    expect(errors).toHaveError(2739, /stockKg/) // 2739: object literal missing required props — reported on the body
    expect(errors).toHaveError(/missing/)
    expectNoLeak(errors)
  })

  it('a wrong body field type → one diagnostic naming the expected type', () => {
    const { errors } = project.check`
      ${setup}
      api.post('/fruits', { body: { name: 'x', emoji: '🥝', color: 'pink', tags: ['sweet'], pricePerKg: 'NaN', stockKg: 1 } })
    `
    expect(errors).toHaveErrorCount(1)
    expect(errors).toHaveError(2322, /not assignable to type 'number'/)
    expectNoLeak(errors)
  })

  it('an excess body field → one diagnostic naming the unknown key', () => {
    const { errors } = project.check`
      ${setup}
      api.post('/fruits', { body: { name: 'x', emoji: '🥝', color: 'pink', tags: ['sweet'], pricePerKg: 1, stockKg: 1, bogus: true } })
    `
    expect(errors).toHaveErrorCount(1)
    expect(errors).toHaveError(2353, /'bogus' does not exist/) // native excess check, no NoExcess machinery
    expectNoLeak(errors)
  })

  it('a verb a route does not declare → one diagnostic that names the valid routes', () => {
    const { errors } = project.check`
      ${setup}
      api.post('/health', { body: {} })
    `
    expect(errors).toHaveErrorCount(1)
    // Names the routes that DO declare POST, rather than printing the whole route map.
    expect(errors).toHaveError(/not assignable to parameter of type '"\/fruits" \| "\/checkout" \| "\/import"'/)
    expectNoLeak(errors)
  })

  it('a missing required params option → "Expected 2 arguments", not "not assignable to never"', () => {
    const { errors } = project.check`
      ${setup}
      api.get('/fruits/:id')
    `
    expect(errors).toHaveErrorCount(1)
    expect(errors).toHaveError(2554, /Expected 2 arguments, but got 1/)
    expectNoLeak(errors)
  })

  it('a wrong param key → one diagnostic naming the unknown key', () => {
    const { errors } = project.check`
      ${setup}
      api.get('/fruits/:id', { params: { nope: 'x' } })
    `
    expect(errors).toHaveErrorCount(1)
    expect(errors).toHaveError(2353, /'nope' does not exist/)
    expectNoLeak(errors)
  })
})

/** The hover for a verb method must read as the call shape, not the schema graph. */
describe('hovers are readable', () => {
  it('hovering a verb method shows plain option shapes, no schema internals', () => {
    const { hover } = project.query`
      ${setup}
      api.po${cursor}st('/fruits', {})
    `
    expect(hover).toBeTruthy()
    expectNoLeak([hover!])
    // It still shows the real option shape the user needs.
    expect(hover).toMatch(/body:/)
    expect(hover).toMatch(/pricePerKg: number/)
  })
})
