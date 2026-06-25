/**
 * Nitro codegen (delta 13) — generation plane. The pure `generateRoutesModule`
 * maps collected dux file routes to the `#h3-dux/routes` source and surfaces the
 * runtime-inspectable contradictions, with no Nitro build in the loop. The live
 * prepare/dev lifecycle is exercised by the Nitro fixture (phase 9D).
 */
import type { DuxFileRouteInfo } from './internal/nitro-codegen.ts'
import { describe, expect, it } from 'vitest'
import { generateRoutesModule } from './internal/nitro-codegen.ts'

function route(partial: Partial<DuxFileRouteInfo> & Pick<DuxFileRouteInfo, 'routePath' | 'importSpecifier'>): DuxFileRouteInfo {
  return { form: 'flat', declared: [], flatHasBody: false, methods: 'all', ...partial }
}

describe('generateRoutesModule', () => {
  it('maps a method-locked flat file to a single method entry with filename params', () => {
    const { source, diagnostics } = generateRoutesModule([
      route({ routePath: '/checkout', importSpecifier: './routes/checkout.post', form: 'flat', methods: ['post'] }),
    ])
    expect(diagnostics).toEqual([])
    expect(source).toContain('\'/checkout\': {')
    expect(source).toContain('\'post\': WithFilenameParams<FlatContract<typeof import(\'./routes/checkout.post\').default>, object>')
    // A static route's filename params are `object` (no required params).
    expect(source).not.toContain('post\': WithFilenameParams<FlatContract<typeof import(\'./routes/checkout.post\').default>, {')
  })

  it('derives the filename params type from the route pattern', () => {
    const { source } = generateRoutesModule([
      route({ routePath: '/fruits/:id', importSpecifier: './routes/fruits/[id].get', form: 'flat', methods: ['get'] }),
    ])
    expect(source).toContain('WithFilenameParams<FlatContract<typeof import(\'./routes/fruits/[id].get\').default>, { id: string }>')
  })

  it('projects a shared all-method flat file to every client method', () => {
    const { source, diagnostics } = generateRoutesModule([
      route({ routePath: '/health', importSpecifier: './routes/health', form: 'flat', methods: 'all' }),
    ])
    expect(diagnostics).toEqual([])
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options'])
      expect(source).toContain(`'${method}': WithFilenameParams<FlatContract<`)
  })

  it('rejects a shared all-method handler that declares a body', () => {
    const { diagnostics } = generateRoutesModule([
      route({ routePath: '/upload', importSpecifier: './routes/upload', form: 'flat', methods: 'all', flatHasBody: true }),
    ])
    expect(diagnostics.length).toBe(1)
    expect(diagnostics[0]).toMatch(/validate\.body/)
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

  it('emits an importable, schema-free module shell', () => {
    const { source } = generateRoutesModule([
      route({ routePath: '/health', importSpecifier: './routes/health', form: 'flat', methods: ['get'] }),
    ])
    expect(source).toContain('import type { FileMethods, FlatContract, WithFilenameParams } from \'@mszr/h3-dux\'')
    expect(source).toContain('export interface Routes {')
    expect(source).not.toMatch(/ObjectSchema|SchemaWithPipe/)
  })
})
