import { cursor } from '@mszr/selenita'
import { duxProject } from '@test'
import { describe, expect, it } from 'vitest'

const project = duxProject()

const setup = `
  import { createClient } from '@mszr/h3-dux'
  import type { App } from '@test'
  const api = createClient<App>()
`

describe('client verb sugar — editor DX', () => {
  it('the client offers symmetric verb methods', () => {
    const { completions } = project.query`
      ${setup}
      api.${cursor}
    `
    expect(completions).toContainCompletions(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
  })

  it('a verb completes the routes that declare it', () => {
    const { completions } = project.query`
      ${setup}
      api.get('${cursor}')
    `
    expect(completions).toContainCompletions(['/health', '/fruits', '/fruits/:id'])
  })

  it('flags a verb a route does not declare, at the call site', () => {
    const { errors } = project.check`
      ${setup}
      api.post('/health', { body: {} })
    `
    expect(errors).toHaveError(/not assignable/)
  })
})
