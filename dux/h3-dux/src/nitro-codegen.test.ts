/**
 * Nitro codegen (delta 13) — generation plane. The pure `generateRoutesModule`
 * maps collected dux file routes to the `#h3-dux/routes` source: a flat file re-keyed
 * to its filename method(s) via `FileFlatContract` (an unsuffixed file under every
 * method, HEAD included), a method map projected per declared method, plus a per-file
 * `Expect<AssertFileRoute<…>>` carrying params/filename agreement into the typecheck.
 * It also surfaces the runtime-inspectable contradictions. The live prepare/dev
 * lifecycle is exercised by the Nitro fixture (phase 9D).
 */
import type { H3DuxFileRouteInfo } from './internal/nitro-codegen.ts'
import { describe, expect, it } from 'vitest'
import { generateNitroRouteTypes, generateRoutesModule } from './internal/nitro-codegen.ts'

function route(partial: Partial<H3DuxFileRouteInfo> & Pick<H3DuxFileRouteInfo, 'routePath' | 'importSpecifier'>): H3DuxFileRouteInfo {
  return { form: 'flat', declared: [], flatHasBody: false, methods: 'all', ...partial }
}

describe('generateRoutesModule', () => {
  it('re-keys a method-locked flat file to its filename method', () => {
    const { source, diagnostics } = generateRoutesModule([
      route({ routePath: '/checkout', importSpecifier: './routes/checkout.post', form: 'flat', methods: ['post'] }),
    ])
    expect(diagnostics).toEqual([])
    expect(source).toContain('\'/checkout\': {')
    expect(source).toContain('\'post\': FileFlatContract<typeof import(\'./routes/checkout.post\').default, \'post\', object>')
  })

  it('derives the filename params type from the route pattern', () => {
    const { source } = generateRoutesModule([
      route({ routePath: '/fruits/:id', importSpecifier: './routes/fruits/[id].get', form: 'flat', methods: ['get'] }),
    ])
    expect(source).toContain('FileFlatContract<typeof import(\'./routes/fruits/[id].get\').default, \'get\', { id: string }>')
  })

  it('projects a shared all-method flat file to every client method, HEAD included', () => {
    const { source, diagnostics } = generateRoutesModule([
      route({ routePath: '/health', importSpecifier: './routes/health', form: 'flat', methods: 'all' }),
    ])
    expect(diagnostics).toEqual([])
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'])
      expect(source).toContain(`'${method}': FileFlatContract<typeof import('./routes/health').default, '${method}', object>`)
  })

  it('rejects a shared all-method handler that declares a body', () => {
    const { diagnostics } = generateRoutesModule([
      route({ routePath: '/upload', importSpecifier: './routes/upload', form: 'flat', methods: 'all', flatHasBody: true }),
    ])
    expect(diagnostics.length).toBe(1)
    expect(diagnostics[0]).toMatch(/validate\.body/)
  })

  it('rejects a GET-locked flat handler that declares a body (bodyless method)', () => {
    const { diagnostics } = generateRoutesModule([
      route({ routePath: '/search', importSpecifier: './routes/search.get', form: 'flat', methods: ['get'], flatHasBody: true }),
    ])
    expect(diagnostics.length).toBe(1)
    expect(diagnostics[0]).toMatch(/bodyless/)
  })

  it('maps a method map to one entry per declared method, sharing route params', () => {
    const { source, diagnostics } = generateRoutesModule([
      route({
        routePath: '/fruits/:id',
        importSpecifier: './routes/fruits/[id]',
        form: 'methods',
        declared: ['get', 'delete'],
        methods: 'all',
      }),
    ])
    expect(diagnostics).toEqual([])
    expect(source).toContain('\'get\': WithFilenameParams<FileMethods<typeof import(\'./routes/fruits/[id]\').default>[\'get\'], { id: string }>')
    expect(source).toContain('\'delete\': WithFilenameParams<FileMethods<typeof import(\'./routes/fruits/[id]\').default>[\'delete\'], { id: string }>')
  })

  it('rejects a method-locked file authored as a method map (unreachable methods)', () => {
    const { diagnostics } = generateRoutesModule([
      route({
        routePath: '/checkout',
        importSpecifier: './routes/checkout.post',
        form: 'methods',
        declared: ['get', 'post'],
        methods: ['post'],
      }),
    ])
    expect(diagnostics.length).toBe(1)
    expect(diagnostics[0]).toMatch(/unreachable/)
  })

  it('flags the same route + method declared by two files', () => {
    const { diagnostics } = generateRoutesModule([
      route({ routePath: '/dup', importSpecifier: './routes/dup.get', form: 'flat', methods: ['get'] }),
      route({ routePath: '/dup', importSpecifier: './routes/dup2.get', form: 'flat', methods: ['get'] }),
    ])
    expect(diagnostics.length).toBe(1)
    expect(diagnostics[0]).toMatch(/more than once/)
  })

  it('emits a params/filename agreement assertion per file', () => {
    const { source } = generateRoutesModule([
      route({ routePath: '/fruits/:id', importSpecifier: './routes/fruits/[id].get', form: 'flat', methods: ['get'] }),
    ])
    expect(source).toContain('type _Assert0 = Expect<AssertFileRoute<typeof import(\'./routes/fruits/[id].get\').default, { id: string }, \'flat\'>>')
  })

  it('emits an importable, schema-free module shell', () => {
    const { source } = generateRoutesModule([
      route({ routePath: '/health', importSpecifier: './routes/health', form: 'flat', methods: ['get'] }),
    ])
    expect(source).toContain('import type { AssertFileRoute, Expect, FileFlatContract, FileMethods, WithFilenameParams } from \'@mszr/h3-dux\'')
    expect(source).toContain('export interface Routes {')
    expect(source).not.toMatch(/ObjectSchema|SchemaWithPipe/)
  })

  it('emits fully-qualified Nitro InternalApi method types', () => {
    const { entries, diagnostics } = generateNitroRouteTypes([
      route({ routePath: '/fruits/:id', importSpecifier: './routes/fruits/[id].get', form: 'flat', methods: ['get'] }),
    ])
    expect(diagnostics).toEqual([])
    expect(entries[0]?.methods.get).toBe(
      'import("@mszr/h3-dux").NitroDataOf<import("@mszr/h3-dux").FileFlatContract<typeof import(\'./routes/fruits/[id].get\').default, \'get\', { id: string }>>',
    )
  })
})
