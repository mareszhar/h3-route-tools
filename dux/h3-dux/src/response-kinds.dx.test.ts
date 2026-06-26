import type { Diagnostic } from '@mszr/selenita'
import { cursor } from '@mszr/selenita'
import { duxProject } from '@test'
import { describe, expect, it } from 'vitest'

const project = duxProject()

/** The schema/endpoint internals a response-kind diagnostic must never leak (delta 6 bar). */
const LEAK = /ObjectSchema|SchemaWithPipe|H3DuxEndpoint|TextResponse|BinaryResponse|EventStream|No overload|Overload \d/

function expectNoLeak(messages: Array<Diagnostic | string>): void {
  for (const m of messages)
    expect(typeof m === 'string' ? m : m.message).not.toMatch(LEAK)
}

describe('response kinds — editor DX', () => {
  it('the response-kind markers complete alongside each other', () => {
    const { completions } = project.query`
      import { ${cursor} } from '@mszr/h3-dux'
    `
    expect(completions).toContainCompletions(['sse', 'text', 'binary', 'typedResponse'])
  })

  it('authoring a text() / binary() route is clean', () => {
    const { errors } = project.check`
      import { binary, createServer, text } from '@mszr/h3-dux'
      void createServer()
        .get('/label', { validate: { response: binary() }, handler: () => new Blob(['x']) })
        .get('/note', { validate: { response: text() }, handler: () => 'ok' })
    `
    expect(errors).toBeClean()
  })

  it('a text() handler returning a non-string → one leak-free diagnostic', () => {
    const { errors } = project.check`
      import { createServer, text } from '@mszr/h3-dux'
      void createServer().get('/note', {
        validate: { response: text() },
        handler: () => 42,
      })
    `
    expect(errors).toHaveErrorCount(1)
    expect(errors).toHaveError(2322, /not assignable to type 'string/)
    expectNoLeak(errors)
  })

  it('a binary() client response narrows to Blob, never a parsed object', () => {
    const { completions } = project.query`
      import { createClient } from '@mszr/h3-dux'
      import type { App } from '@test'
      const api = createClient<App>()
      async function trip() {
        const label = await api.get('/fruits/:id/label', { params: { id: 'm' } }).orThrow()
        label.${cursor}
      }
    `
    // Blob members, not Fruit fields — the body decoded by kind.
    expect(completions).toContainCompletions(['arrayBuffer', 'slice', 'stream', 'type'])
  })

  it('the ceremony-free string path infers string completions', () => {
    const { completions } = project.query`
      import { createClient, createServer } from '@mszr/h3-dux'
      const app = createServer().get('/motd', { handler: () => 'ripe' })
      const api = createClient<typeof app>()
      async function trip() {
        const motd = await api.get('/motd').orThrow()
        motd.${cursor}
      }
    `
    expect(completions).toContainCompletions(['charAt', 'includes', 'toUpperCase'])
  })

  it('typedResponse() preserves native-response body IntelliSense', () => {
    const { completions } = project.query`
      import { createClient, createServer, typedResponse } from '@mszr/h3-dux'
      const app = createServer().get('/native', {
        handler: () => typedResponse({ orchard: 'ripe' as const, count: 4 }),
      })
      const api = createClient<typeof app>()
      async function trip() {
        const body = await (await api.get('/native').raw()).parse()
        body.${cursor}
      }
    `
    expect(completions).toContainCompletions(['orchard', 'count'])
  })

  it('.raw() offers the universal parse() path and native Response methods', () => {
    const { completions } = project.query`
      import { createClient } from '@mszr/h3-dux'
      import type { App } from '@test'
      const api = createClient<App>()
      async function trip() {
        const response = await api.get('/health/text').raw()
        response.${cursor}
      }
    `
    expect(completions).toContainCompletions(['parse', 'json', 'text', 'blob', 'headers', 'status'])
  })

  it('a body on a 204 fails once at the handler with no internal type leak', () => {
    const { errors } = project.check`
      import { createServer } from '@mszr/h3-dux'
      void createServer().get('/empty', {
        status: 204,
        handler: () => ({ nope: true }),
      })
    `
    expect(errors).toHaveErrorCount(1)
    expect(errors).toHaveError(2322, /not assignable/)
    expectNoLeak(errors)
  })
})
