import { cursor } from '@mszr/selenita'
import { duxProject } from '@test'
import { describe, expect, it } from 'vitest'

const project = duxProject()

const setup = `
  import { createClient } from '@mszr/h3-dux'
  import type { App } from '@test'
  const api = createClient<App>()
`

describe('honest client — editor DX', () => {
  it('the call handle offers orThrow, raw, and await', () => {
    const { completions } = project.query`
      ${setup}
      api.get('/health').${cursor}
    `
    expect(completions).toContainCompletions(['orThrow', 'raw', 'then'])
  })

  it('the awaited result completes data and error', () => {
    const { completions } = project.query`
      ${setup}
      async function trip() {
        const result = await api.get('/fruits/:id', { params: { id: 'm' } })
        result.${cursor}
      }
    `
    expect(completions).toContainCompletions(['data', 'error'])
  })

  it('the error channel completes its discriminant and carriers', () => {
    const { completions } = project.query`
      ${setup}
      async function trip() {
        const { error } = await api.post('/fruits/:id/reserve', { params: { id: 'x' } })
        if (error)
          error.${cursor}
      }
    `
    expect(completions).toContainCompletions(['kind'])
  })

  it('a declared HTTP error narrows status and data', () => {
    const { completions } = project.query`
      ${setup}
      async function trip() {
        const { error } = await api.post('/fruits/:id/reserve', { params: { id: 'x' } })
        if (error && error.kind === 'http')
          error.${cursor}
      }
    `
    expect(completions).toContainCompletions(['status', 'data', 'response'])
  })
})
