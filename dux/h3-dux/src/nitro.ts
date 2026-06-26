/**
 * The h3-dux Nitro module (delta 13, step 9C). Add it to `nitro.config.ts`:
 * `modules: ['@mszr/h3-dux/nitro']`. Build-time only.
 *
 * It teaches Nitro about dux file routes: for every `default` export built by
 * `defineFileRoute` / a `createFileRouteFactory`, it reads Nitro's own route table
 * (the path/method truth) plus the handler's authoring form, and emits a generated
 * `#h3-dux/routes` type map — `{ [path]: { [method]: EndpointContract } }` — that
 * `createClient<Routes>()` consumes with no hand-written route interface. Generation
 * fails the build on the runtime-inspectable contradictions (an unreachable-method
 * file, a body-bearing shared handler, a duplicate route+method).
 *
 * Plain Nitro handlers and inherited upstream `defineRouteHandler` files keep
 * working; inherited upstream handlers keep their `InternalApi`/`$fetch` contract,
 * and all non-dux routes are omitted from the h3-dux client map (an untyped route
 * is never given a fictional contract). OpenAPI enrichment is intentionally left
 * to phase 10's refined design. The full upstream Nitro surface is re-exported below.
 */
import type { NitroModule, NitroTypes } from 'nitro/types'
import type { DuxFileRouteInfo } from './internal/nitro-codegen.ts'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { generateNitroRouteTypes, generateRoutesModule } from './internal/nitro-codegen.ts'

// Re-export the upstream Nitro surface unchanged (collectRouteHandlers, OpenAPI
// helpers, …) so advanced users can still reach the inherited building blocks.
export * from 'h3-route-tools/nitro'

/** One method entry's generated type strings, as Nitro stores them in its route table. */
type RouteMethodTypes = readonly string[] | undefined

/** The runtime form markers a built dux file handler carries (see file-route.ts). */
interface DuxFileMarkers {
  '~duxFile'?: true
  '~duxForm'?: 'flat' | 'methods'
  '~duxDeclared'?: readonly string[]
  '~duxFlatHasBody'?: boolean
  '~routeDef'?: Record<string, unknown>
}

interface UpstreamRouteInfo {
  routePath: string
  importSpecifier: string
  declared: readonly string[]
  methods: readonly string[] | 'all'
}

/** The result of collecting file routes: the dux routes, plus modules we could not inspect. */
export interface CollectResult {
  infos: DuxFileRouteInfo[]
  upstream: UpstreamRouteInfo[]
  /** Specifiers whose module threw on import — surfaced as a warning, never dropped in silence. */
  unreadable: string[]
}

/** The `import('…')` specifier Nitro put in a route's generated type string (relative to typesDir). */
function routeImportSpecifier(typeStrings: RouteMethodTypes): string | undefined {
  return typeStrings?.[0]?.match(/import\('([^']+)'\)/)?.[1]
}

const CALLABLE_METHODS = ['get', 'head', 'post', 'put', 'patch', 'delete', 'options'] as const

function declaredMethods(routeDef: Record<string, unknown>): string[] {
  return CALLABLE_METHODS.filter(method => typeof routeDef[method] === 'object' && routeDef[method] !== null)
}

/**
 * Import a route module to read its h3-route-tools/dux markers. Returns markers when
 * the route is inspectable, `undefined` for a plain Nitro route, or `'error'` when
 * the import throws — surfaced as a warning instead of silently omitting the route.
 * The dux form (flat vs method map) is read here because the *type* cannot express
 * it: the definer infers both kernel brands as a union, so only the runtime value
 * records it.
 */
async function loadDuxMarkers(spec: string, typesDir: string): Promise<DuxFileMarkers | undefined | 'error'> {
  try {
    const mod = await import(resolve(typesDir, `${spec}.ts`))
    const def = mod.default as DuxFileMarkers | undefined
    return def?.['~duxFile'] || def?.['~routeDef'] ? def : undefined
  }
  catch {
    return 'error'
  }
}

/**
 * Walk Nitro's route table and collect the dux file routes. Per path, each specifier
 * is mapped to the method(s) it serves — `'all'` for the unsuffixed catch-all (Nitro's
 * `default` key), else the specific method keys — then imported to read its form. A
 * module that fails to import is recorded in `unreadable` (a visible warning), never
 * dropped without a trace; a module that imports but isn't a dux route is skipped.
 */
export async function collectFileRoutes(routes: NitroTypes['routes'], typesDir: string): Promise<CollectResult> {
  const infos: DuxFileRouteInfo[] = []
  const upstream: UpstreamRouteInfo[] = []
  const unreadable: string[] = []
  for (const [routePath, methods] of Object.entries(routes)) {
    const table = methods as Record<string, RouteMethodTypes>
    // specifier → the methods it serves on this path (`'all'` for the catch-all handler).
    const served = new Map<string, Set<string> | 'all'>()
    for (const [method, typeStrings] of Object.entries(table)) {
      const spec = routeImportSpecifier(typeStrings)
      if (!spec)
        continue
      if (method === 'default') {
        served.set(spec, 'all')
        continue
      }
      const current = served.get(spec)
      if (current === 'all')
        continue
      const set = current ?? new Set<string>()
      set.add(method)
      served.set(spec, set)
    }

    for (const [importSpecifier, methodSet] of served) {
      const markers = await loadDuxMarkers(importSpecifier, typesDir)
      if (markers === 'error') {
        unreadable.push(importSpecifier)
        continue
      }
      if (!markers)
        continue
      const methods = methodSet === 'all' ? 'all' as const : [...methodSet]
      if (markers['~duxFile']) {
        infos.push({
          routePath,
          importSpecifier,
          form: markers['~duxForm'] ?? 'flat',
          declared: markers['~duxDeclared'] ?? [],
          flatHasBody: !!markers['~duxFlatHasBody'],
          methods,
        })
      }
      else if (markers['~routeDef']) {
        upstream.push({
          routePath,
          importSpecifier,
          declared: declaredMethods(markers['~routeDef']),
          methods,
        })
      }
    }
  }
  return { infos, upstream, unreadable }
}

/**
 * The directory Nitro writes its generated `tsconfig.json` + route types to — the
 * base the `#h3-dux/routes` path and the route import specifiers resolve against.
 * `typescript.generatedTypesDir` (default `node_modules/.nitro/types`) is the truth;
 * it can diverge from `buildDir/types`.
 */
function typesDirOf(nitro: Parameters<NitroModule['setup']>[0]): string {
  const generated = nitro.options.typescript?.generatedTypesDir ?? join(nitro.options.buildDir, 'types')
  return isAbsolute(generated) ? generated : resolve(nitro.options.rootDir, generated)
}

/** Register the `#h3-dux/routes` import path in Nitro's generated tsconfig. */
function registerRoutesPath(nitro: Parameters<NitroModule['setup']>[0]): void {
  const ts = (nitro.options.typescript ??= {})
  const tsConfig = (ts.tsConfig ??= {})
  const compilerOptions = (tsConfig.compilerOptions ??= {})
  compilerOptions.paths = { ...compilerOptions.paths, '#h3-dux/routes': ['./h3-dux-routes'] }
}

function methodLockMessage(route: UpstreamRouteInfo, locked: readonly string[]): string {
  return [
    `  "${route.importSpecifier}" is locked to ${locked.map(method => method.toUpperCase()).join(', ')} by its filename, but defineRouteHandler declares: ${route.declared.join(', ')}.`,
    `  Nitro only routes the filename method(s) to it, so the other method(s) are unreachable.`,
    `  Fix: rename it to an unsuffixed file or split each method into its own *.<method>.ts file.`,
  ].join('\n')
}

function upstreamMethodType(spec: string, method: string): string {
  return `import("h3-route-tools/nitro").NitroMethodsOf<typeof import('${spec}').default>['${method}']`
}

function applyRouteTypeEntries(
  routes: NitroTypes['routes'],
  entries: Array<{ routePath: string, methods: Record<string, string> }>,
): void {
  for (const entry of entries) {
    const current = { ...(routes[entry.routePath] as Record<string, RouteMethodTypes> | undefined) }
    // A dux unsuffixed route starts as Nitro's broad `default`; replace it with
    // explicit method entries so InternalApi sees the same method map as the client.
    delete current.default
    for (const [method, type] of Object.entries(entry.methods))
      current[method] = [type]
    ;(routes as Record<string, Record<string, readonly string[]>>)[entry.routePath] = current as Record<string, readonly string[]>
  }
}

function applyUpstreamRouteTypes(routes: NitroTypes['routes'], upstream: readonly UpstreamRouteInfo[]): string[] {
  const diagnostics: string[] = []
  for (const route of upstream) {
    const current = { ...(routes[route.routePath] as Record<string, RouteMethodTypes> | undefined) }
    if (route.methods === 'all') {
      delete current.default
      for (const method of route.declared)
        current[method] = [upstreamMethodType(route.importSpecifier, method)]
    }
    else {
      const locked = route.methods.map(method => method.toLowerCase())
      const unreachable = route.declared.filter(method => !locked.includes(method))
      if (unreachable.length > 0) {
        diagnostics.push(methodLockMessage(route, locked))
        continue
      }
      for (const method of locked) {
        if (route.declared.includes(method))
          current[method] = [upstreamMethodType(route.importSpecifier, method)]
      }
    }
    ;(routes as Record<string, Record<string, readonly string[]>>)[route.routePath] = current as Record<string, readonly string[]>
  }
  return diagnostics
}

/**
 * The h3-dux Nitro module. Generates `#h3-dux/routes` from the dux file routes on
 * every `types:extend` (prepare, dev add/remove/rename, build) and fails the build
 * on a generation diagnostic.
 *
 * The module is emitted as a real `.ts`, not a `.d.ts`: Nitro's generated tsconfig
 * sets `skipLibCheck`, which would skip the filename-truth assertions in a declaration
 * file. `#h3-dux/routes` resolves to it just the same (the path drops the extension),
 * and as a `.ts` it carries no runtime — only the `Routes` type and the assertions.
 */
export const h3Dux: NitroModule = {
  name: 'h3-dux',
  setup(nitro) {
    const typesDir = typesDirOf(nitro)
    registerRoutesPath(nitro)

    nitro.hooks.hook('types:extend', async (types) => {
      const { infos, upstream, unreadable } = await collectFileRoutes(types.routes, typesDir)
      // Never drop a route in silence: if a module could not be inspected (it likely
      // imports server-only code that can't run at type generation), say so loudly.
      for (const spec of unreadable) {
        const warn = nitro.logger?.warn ?? console.warn
        warn(
          `[h3-dux] could not inspect route module '${spec}' — if it is a dux file route, it is absent from #h3-dux/routes.\n`
          + `  The import threw at type generation (it may pull in server-only code). Keep its inspectable parts importable, or move that work behind a runtime guard.`,
        )
      }
      const { source, diagnostics } = generateRoutesModule(infos)
      const nitroTypes = generateNitroRouteTypes(infos)
      diagnostics.push(...nitroTypes.diagnostics)
      diagnostics.push(...applyUpstreamRouteTypes(types.routes, upstream))
      if (diagnostics.length > 0) {
        throw new Error(
          `[h3-dux] Nitro route generation failed:\n\n${[...new Set(diagnostics)].join('\n\n')}`,
        )
      }
      applyRouteTypeEntries(types.routes, nitroTypes.entries)
      await mkdir(typesDir, { recursive: true })
      await writeFile(join(typesDir, 'h3-dux-routes.ts'), source)
      // Drop a stale declaration file from a prior version so it can't shadow the `.ts`.
      await rm(join(typesDir, 'h3-dux-routes.d.ts'), { force: true })
    })
  },
}

export default h3Dux
