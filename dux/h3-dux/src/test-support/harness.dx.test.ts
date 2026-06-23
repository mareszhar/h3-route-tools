import { cursor } from '@mszr/selenita'
import { duxProject } from '@test'
import { describe, expect, it } from 'vitest'

const project = duxProject()

describe('harness smoke', () => {
  it('the package surfaces createServer / createClient / sse', () => {
    const { completions } = project.query`
      import { createServer, createClient, sse } from '@mszr/h3-dux'
      const x = { createServer, createClient, sse }
      x.${cursor}
    `
    expect(completions).toContainCompletions(['createServer', 'createClient', 'sse'])
  })
})
