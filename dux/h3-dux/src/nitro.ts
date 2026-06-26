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
 * working and keep Nitro's own `$fetch`/OpenAPI behaviour; they are simply omitted
 * from the dux client map (an untyped route is never given a fictional contract).
 * The full upstream Nitro surface is re-exported below.
 */
import type { NitroModule, NitroTypes } from 'nitro/types'
import type { DuxFileRouteInfo } from './internal/nitro-codegen.ts'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { generateRoutesModule } from './internal/nitro-codegen.ts'

// Re-export the upstream Nitro surface unchanged (collectRouteHandlers, the OpenAPI
// helpers, …) so `@mszr/h3-dux/nitro` is a superset of `h3-route-tools/nitro`.
export * from 'h3-route-tools/nitro'

/** One method entry's generated type strings, as Nitro stores them in its route table. */
type RouteMethodTypes = readonly string[] | undefined

/** The runtime form markers a built dux file handler carries (see file-route.ts). */
interface DuxFileMarkers {
  '~duxFile'?: true
  '~duxForm'?: 'flat' | 'methods'
  '~duxDeclared'?: readonly string[]
  '~duxFlatHasBody'?: boolean
}

/** The result of collecting file routes: the dux routes, plus modules we could not inspect. */
export interface CollectResult {
  infos: DuxFileRouteInfo[]
  /** Specifiers whose module threw on import — surfaced as a warning, never dropped in silence. */
  unreadable: string[]
}

/** The `import('…')` specifier Nitro put in a route's generated type string (relative to typesDir). */
function routeImportSpecifier(typeStrings: RouteMethodTypes): string | undefined {
  return typeStrings?.[0]?.match(/import\('([^']+)'\)/)?.[1]
}

/**
 * Import a route module to read its dux form markers. Returns the markers when it is a
 * dux file route, `undefined` when it imports cleanly but isn't one (skipped quietly,
 * the correct outcome for a plain Nitro route), or `'error'` when the import throws —
 * which the module surfaces as a warning instead of silently omitting the route. The
 * form (flat vs method map) is read here because the *type* cannot express it: the
 * definer infers both kernel brands as a union, so only the runtime value records it.
 */
async function loadDuxMarkers(spec: string, typesDir: string): Promise<DuxFileMarkers | undefined | 'error'> {
  try {
    const mod = await import(resolve(typesDir, `${spec}.ts`))
    const def = mod.default as DuxFileMarkers | undefined
    return def?.['~duxFile'] ? def : undefined
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
      infos.push({
        routePath,
        importSpecifier,
        form: markers['~duxForm'] ?? 'flat',
        declared: markers['~duxDeclared'] ?? [],
        flatHasBody: !!markers['~duxFlatHasBody'],
        methods: methodSet === 'all' ? 'all' : [...methodSet],
      })
    }
  }
  return { infos, unreadable }
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
      const { infos, unreadable } = await collectFileRoutes(types.routes, typesDir)
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
      if (diagnostics.length > 0) {
        throw new Error(
          `[h3-dux] file-route generation failed:\n\n${diagnostics.join('\n\n')}`,
        )
      }
      await mkdir(typesDir, { recursive: true })
      await writeFile(join(typesDir, 'h3-dux-routes.ts'), source)
      // Drop a stale declaration file from a prior version so it can't shadow the `.ts`.
      await rm(join(typesDir, 'h3-dux-routes.d.ts'), { force: true })
    })
  },
}

export default h3Dux
