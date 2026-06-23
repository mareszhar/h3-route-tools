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
})
