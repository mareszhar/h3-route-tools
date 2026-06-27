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
 * Plain Nitro handlers and owned baseline `defineRouteHandler` files keep
 * working; baseline handlers keep their `InternalApi`/`$fetch` contract, and all
 * non-dux routes are omitted from the h3-dux client map (an untyped route is
 * never given a fictional contract).
 */
import type { NitroModule, NitroTypes, Serialize, Simplify } from 'nitro/types'
import type { H3DuxFileHandler } from './file-route.ts'
import type { H3DuxFileRouteInfo } from './internal/nitro-codegen.ts'
import type { H3DuxOpenAPIDocument, H3DuxOpenAPIRoute, ToOpenAPIOptions } from './openapi.ts'
import type { RouteHandler } from './route.ts'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { generateNitroRouteTypes, generateRoutesModule } from './internal/nitro-codegen.ts'
import { buildOpenAPI } from './openapi.ts'

type NitroSetup = Parameters<NitroModule['setup']>[0]
type NitroTypeScriptOptions = NonNullable<NitroSetup['options']['typescript']> & {
  generatedTypesDir?: string
}

/** Nitro's `InternalApi` value for an owned baseline route handler. */
export type NitroMethodsOf<H>
  = H extends RouteHandler<infer _Def, infer Methods>
    ? {
        [M in keyof Methods]: Simplify<
          Serialize<Methods[M] extends { response: infer R } ? R : unknown>
        >
      }
    : never

/** One method entry's generated type strings, as Nitro stores them in its route table. */
type RouteMethodTypes = readonly string[] | undefined

/** The runtime form markers a built dux file handler carries (see file-route.ts). */
interface H3DuxFileMarkers {
  '~duxFile'?: true
  '~duxForm'?: 'flat' | 'methods'
  '~duxDeclared'?: readonly string[]
  '~duxFlatHasBody'?: boolean
  '~routeDef'?: Record<string, unknown>
}

interface BaselineRouteInfo {
  routePath: string
  importSpecifier: string
  declared: readonly string[]
  methods: readonly string[] | 'all'
}

/** The result of collecting file routes: the dux routes, plus modules we could not inspect. */
export interface CollectResult {
  infos: H3DuxFileRouteInfo[]
  baseline: BaselineRouteInfo[]
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
 * Import a route module to read its h3-dux markers. Returns markers when
 * the route is inspectable, `undefined` for a plain Nitro route, or `'error'` when
 * the import throws — surfaced as a warning instead of silently omitting the route.
 * The dux form (flat vs method map) is read here because the *type* cannot express
 * it: the definer infers both kernel brands as a union, so only the runtime value
 * records it.
 */
async function loadDuxMarkers(spec: string, typesDir: string): Promise<H3DuxFileMarkers | undefined | 'error'> {
  try {
    const mod = await import(resolve(typesDir, `${spec}.ts`))
    const def = mod.default as H3DuxFileMarkers | undefined
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
  const infos: H3DuxFileRouteInfo[] = []
  const baseline: BaselineRouteInfo[] = []
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
        baseline.push({
          routePath,
          importSpecifier,
          declared: declaredMethods(markers['~routeDef']),
          methods,
        })
      }
    }
  }
  return { infos, baseline, unreadable }
}

/**
 * The directory Nitro writes its generated `tsconfig.json` + route types to — the
 * base the `#h3-dux/routes` path and the route import specifiers resolve against.
 * Stable Nitro derives it from `typescript.tsconfigPath`; newer betas can expose
 * `typescript.generatedTypesDir` directly. Prefer the direct value when present.
 */
function typesDirOf(nitro: NitroSetup): string {
  const ts = nitro.options.typescript as NitroTypeScriptOptions
  const generated = ts.generatedTypesDir ?? join(nitro.options.buildDir, ts.tsconfigPath, '..')
  return isAbsolute(generated) ? generated : resolve(nitro.options.rootDir, generated)
}

/** Register the `#h3-dux/routes` import path in Nitro's generated tsconfig. */
function registerRoutesPath(nitro: NitroSetup): void {
  const ts = nitro.options.typescript
  const tsConfig = (ts.tsConfig ??= {})
  const compilerOptions = (tsConfig.compilerOptions ??= {})
  compilerOptions.paths = { ...compilerOptions.paths, '#h3-dux/routes': ['./h3-dux-routes'] }
}

function methodLockMessage(route: BaselineRouteInfo, locked: readonly string[]): string {
  return [
    `  "${route.importSpecifier}" is locked to ${locked.map(method => method.toUpperCase()).join(', ')} by its filename, but defineRouteHandler declares: ${route.declared.join(', ')}.`,
    `  Nitro only routes the filename method(s) to it, so the other method(s) are unreachable.`,
    `  Fix: rename it to an unsuffixed file or split each method into its own *.<method>.ts file.`,
  ].join('\n')
}

function baselineMethodType(spec: string, method: string): string {
  return `import("@mszr/h3-dux/nitro").NitroMethodsOf<typeof import('${spec}').default>['${method}']`
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

function applyBaselineRouteTypes(routes: NitroTypes['routes'], baseline: readonly BaselineRouteInfo[]): string[] {
  const diagnostics: string[] = []
  for (const route of baseline) {
    const current = { ...(routes[route.routePath] as Record<string, RouteMethodTypes> | undefined) }
    if (route.methods === 'all') {
      delete current.default
      for (const method of route.declared)
        current[method] = [baselineMethodType(route.importSpecifier, method)]
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
          current[method] = [baselineMethodType(route.importSpecifier, method)]
      }
    }
    ;(routes as Record<string, Record<string, readonly string[]>>)[route.routePath] = current as Record<string, readonly string[]>
  }
  return diagnostics
}

const NITRO_OPENAPI_BASE_ROUTE = '/_openapi.__h3dux-base.json'

async function loadRouteDefault(spec: string, typesDir: string): Promise<H3DuxFileHandler | undefined> {
  try {
    const mod = await import(resolve(typesDir, `${spec}.ts`))
    return mod.default as H3DuxFileHandler | undefined
  }
  catch {
    return undefined
  }
}

function openAPIMethods(info: H3DuxFileRouteInfo, handler: H3DuxFileHandler): string[] {
  const docs = handler['~duxOpenAPI']
  if (!docs)
    return []
  if (info.methods === 'all')
    return Object.keys(docs.methods)
  return info.methods.map(method => method.toLowerCase())
}

async function buildDuxOpenAPIOverlay(
  infos: readonly H3DuxFileRouteInfo[],
  typesDir: string,
  options: ToOpenAPIOptions,
): Promise<H3DuxOpenAPIDocument> {
  const routes: H3DuxOpenAPIRoute[] = []
  for (const info of infos) {
    const handler = await loadRouteDefault(info.importSpecifier, typesDir)
    const docs = handler?.['~duxOpenAPI']
    if (!docs)
      continue
    for (const method of openAPIMethods(info, handler!)) {
      const methods = docs.methods as Record<string, typeof docs.methods.get>
      const entry = methods[method] ?? methods.get
      if (!entry)
        continue
      routes.push({
        route: info.routePath,
        method: method as H3DuxOpenAPIRoute['method'],
        params: docs.params,
        validate: entry.validate,
        status: entry.status,
        errors: entry.errors,
        openapi: entry.openapi,
      })
    }
  }
  return buildOpenAPI(routes, options)
}

function openAPIOptions(nitro: Parameters<NitroModule['setup']>[0]): ToOpenAPIOptions {
  const configured = (nitro.options as unknown as { h3Dux?: { openapi?: ToOpenAPIOptions } }).h3Dux?.openapi
  if (configured)
    return configured
  const openAPI = (nitro.options as unknown as { openAPI?: { meta?: { title?: string, version?: string } } }).openAPI
  return {
    info: {
      title: openAPI?.meta?.title ?? 'API',
      version: openAPI?.meta?.version ?? '1.0.0',
    },
  }
}

function openAPIHandlerSource(overlayJSON: string): string {
  return [
    `import { defineLazyEventHandler, defineHandler, getRequestURL } from "h3";`,
    `import { fetch } from "nitro";`,
    `import { useRuntimeConfig } from "nitro/runtime-config";`,
    `const overlay = ${overlayJSON};`,
    `const joinURL = (origin, base) => (!base || base === "/" ? origin : origin.replace(/\\/$/, "") + "/" + base.replace(/^\\/+/, ""));`,
    `const readBase = async () => {`,
    `  try {`,
    `    const response = await fetch(${JSON.stringify(NITRO_OPENAPI_BASE_ROUTE)});`,
    `    return response.ok ? await response.json() : {};`,
    `  } catch {`,
    `    return {};`,
    `  }`,
    `};`,
    `export default defineLazyEventHandler(async () => {`,
    `  const base = await readBase();`,
    `  const paths = { ...base.paths, ...overlay.paths };`,
    `  delete paths[${JSON.stringify(NITRO_OPENAPI_BASE_ROUTE)}];`,
    `  const schemas = { ...base.components?.schemas, ...overlay.components?.schemas };`,
    `  const componentsBase = { ...base.components, ...overlay.components };`,
    `  const components = Object.keys(schemas).length ? { ...componentsBase, schemas } : Object.keys(componentsBase).length ? componentsBase : undefined;`,
    `  const doc = { openapi: "3.1.0", ...base, ...overlay, paths, ...(components ? { components } : {}) };`,
    `  const server0 = doc.servers?.[0] ?? {};`,
    `  return defineHandler((event) => ({`,
    `    ...doc,`,
    `    servers: overlay.servers ?? [{ ...server0, url: joinURL(getRequestURL(event).origin, useRuntimeConfig().app?.baseURL) }],`,
    `  }));`,
    `});`,
  ].join('\n')
}

function overrideOpenAPI(nitro: Parameters<NitroModule['setup']>[0], overlay: () => string): void {
  nitro.options.virtual['#h3-dux/openapi'] = () => openAPIHandlerSource(overlay())
  nitro.hooks.hook('compiled', () => {
    const route = (nitro.options as unknown as { openAPI?: { route?: string } }).openAPI?.route || '/_openapi.json'
    const existing = nitro.options.handlers.find(
      h => h.route === route && String(h.handler).includes('internal/routes/openapi'),
    )
    if (existing)
      existing.route = NITRO_OPENAPI_BASE_ROUTE
    nitro.options.handlers.push({ route, handler: '#h3-dux/openapi' })
  })
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
    let overlayJSON = JSON.stringify({ openapi: '3.1.0', info: openAPIOptions(nitro).info, paths: {} })
    registerRoutesPath(nitro)

    if (nitro.options.experimental?.openAPI)
      overrideOpenAPI(nitro, () => overlayJSON)

    nitro.hooks.hook('types:extend', async (types: NitroTypes) => {
      const { infos, baseline, unreadable } = await collectFileRoutes(types.routes, typesDir)
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
      diagnostics.push(...applyBaselineRouteTypes(types.routes, baseline))
      if (diagnostics.length > 0) {
        throw new Error(
          `[h3-dux] Nitro route generation failed:\n\n${[...new Set(diagnostics)].join('\n\n')}`,
        )
      }
      applyRouteTypeEntries(types.routes, nitroTypes.entries)
      if (nitro.options.experimental?.openAPI)
        overlayJSON = JSON.stringify(await buildDuxOpenAPIOverlay(infos, typesDir, openAPIOptions(nitro)))
      await mkdir(typesDir, { recursive: true })
      await writeFile(join(typesDir, 'h3-dux-routes.ts'), source)
      // Drop a stale declaration file from a prior version so it can't shadow the `.ts`.
      await rm(join(typesDir, 'h3-dux-routes.d.ts'), { force: true })
    })
  },
}

export default h3Dux
