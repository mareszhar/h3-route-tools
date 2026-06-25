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
import type { DuxFileRouteInfo, NitroMethods } from './internal/nitro-codegen.ts'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { generateRoutesModule } from './internal/nitro-codegen.ts'

// Re-export the upstream Nitro surface unchanged (collectRouteHandlers, the OpenAPI
// helpers, …) so `@mszr/h3-dux/nitro` is a superset of `h3-route-tools/nitro`.
export * from 'h3-route-tools/nitro'

/** The runtime markers a built dux file handler carries (see file-route.ts). */
interface DuxFileMarkers {
  '~duxFile'?: true
  '~duxForm'?: 'flat' | 'methods'
  '~duxDeclared'?: readonly string[]
  '~duxFlatHasBody'?: boolean
}

/** The `import('…')` specifier Nitro put in a route's generated type string (relative to typesDir). */
function routeImportSpecifier(typeStrings: readonly string[] | undefined): string | undefined {
  return typeStrings?.[0]?.match(/import\('([^']+)'\)/)?.[1]
}

/** Import a route module and return its dux markers, or undefined if it isn't a dux file route. */
async function loadDuxMarkers(spec: string, typesDir: string): Promise<DuxFileMarkers | undefined> {
  try {
    const mod = await import(resolve(typesDir, `${spec}.ts`))
    const def = mod.default as DuxFileMarkers | undefined
    return def?.['~duxFile'] ? def : undefined
  }
  catch {
    return undefined
  }
}

/**
 * Walk Nitro's route table and collect the dux file routes — each with the filename
 * path/method truth (`'all'` for an unsuffixed catch-all) and the handler's form.
 */
export async function collectDuxFileRoutes(
  routes: NitroTypes['routes'],
  typesDir: string,
): Promise<DuxFileRouteInfo[]> {
  const infos: DuxFileRouteInfo[] = []
  for (const [routePath, methods] of Object.entries(routes)) {
    const isCatchAll = 'default' in methods
    const methodKeys = Object.keys(methods).filter(key => key !== 'default')
    const specifiers = new Set<string>()
    for (const typeStrings of Object.values(methods)) {
      const spec = routeImportSpecifier(typeStrings)
      if (spec)
        specifiers.add(spec)
    }
    for (const importSpecifier of specifiers) {
      const def = await loadDuxMarkers(importSpecifier, typesDir)
      if (!def)
        continue
      infos.push({
        routePath,
        importSpecifier,
        form: def['~duxForm'] ?? 'flat',
        declared: def['~duxDeclared'] ?? [],
        flatHasBody: !!def['~duxFlatHasBody'],
        methods: (isCatchAll ? 'all' : methodKeys) as NitroMethods,
      })
    }
  }
  return infos
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
 */
export const h3Dux: NitroModule = {
  name: 'h3-dux',
  setup(nitro) {
    const typesDir = typesDirOf(nitro)
    registerRoutesPath(nitro)

    nitro.hooks.hook('types:extend', async (types) => {
      const infos = await collectDuxFileRoutes(types.routes, typesDir)
      const { source, diagnostics } = generateRoutesModule(infos)
      if (diagnostics.length > 0) {
        throw new Error(
          `[h3-dux] file-route generation failed:\n\n${diagnostics.join('\n\n')}`,
        )
      }
      await mkdir(typesDir, { recursive: true })
      await writeFile(join(typesDir, 'h3-dux-routes.d.ts'), source)
    })
  },
}

export default h3Dux
