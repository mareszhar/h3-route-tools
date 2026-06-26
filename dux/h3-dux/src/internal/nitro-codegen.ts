/**
 * Nitro codegen for dux file routes (delta 13, step 9C). Pure string generation,
 * kept apart from the Nitro module (`nitro.ts`) so it is unit-testable without a
 * Nitro build. It turns each collected dux file handler — its filename-derived
 * path/method (Nitro's route table is the truth) and its authoring form — into one
 * `#h3-dux/routes` entry, projecting the handler's kernel through the type-only
 * `FileFlatContract` / `FileMethods` helpers so the result stays schema-free and
 * re-links to source on every regenerate.
 *
 * A flat route is re-keyed to the filename's method via `FileFlatContract`, so a
 * `*.head.ts` projects empty and a `*.get.ts` cannot claim a body; an unsuffixed
 * flat file is projected under every method, `HEAD` included (empty). A method map
 * projects each declared method.
 *
 * Generation rejects the runtime-inspectable contradictions: an unreachable-method
 * file, a body-bearing shared (or GET/HEAD) flat handler, and a route+method two
 * files both declare. The shape-only params/filename agreement rides project
 * typecheck instead, as an `Expect<AssertFileRoute<…>>` per file.
 */

/** The methods Nitro routes to a file: an explicit list (`*.post.ts`) or `'all'` (catch-all). */
export type NitroMethods = readonly string[] | 'all'

/** One collected dux file route — the codegen input, recovered from Nitro + the handler. */
export interface H3DuxFileRouteInfo {
  /** The Nitro-normalized route path, e.g. `/fruits/:id`. */
  routePath: string
  /** The `import('…')` specifier the generated module uses for this file's `default`. */
  importSpecifier: string
  /** The authoring form, from the handler's runtime marker. */
  form: 'flat' | 'methods'
  /** Method-map: the declared methods; flat: empty. */
  declared: readonly string[]
  /** Flat: whether `validate.body` was declared (illegal for a shared/GET/HEAD file). */
  flatHasBody: boolean
  /** The methods Nitro routes here (filename truth). */
  methods: NitroMethods
}

/** The result of generation — the module source and any blocking diagnostics. */
export interface GenerateResult {
  source: string
  diagnostics: string[]
}

/** A generated replacement for Nitro's own `types.routes[path][method]` entry. */
export interface NitroRouteTypeEntry {
  routePath: string
  methods: Record<string, string>
}

export interface NitroRouteTypesResult {
  entries: NitroRouteTypeEntry[]
  diagnostics: string[]
}

/** Client-visible methods a shared (catch-all) flat file is projected to — `HEAD` included (empty). */
const SHARED_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const
/** Methods whose wire request carries no body — a flat file locked to one cannot declare `validate.body`. */
const BODYLESS_METHODS = new Set(['get', 'head'])
const PARAM_RE = /:(\w+)/g

/** The filename-derived params type literal: `{ id: string }`, or `object` when static. */
function paramsLiteral(routePath: string): string {
  const names = [...routePath.matchAll(PARAM_RE)].map(match => match[1])
  return names.length > 0 ? `{ ${names.map(name => `${name}: string`).join('; ')} }` : 'object'
}

/** `typeof import('<spec>').default` — the built file handler the kernel is read from. */
function handlerRef(spec: string): string {
  return `typeof import('${spec}').default`
}

function qualifyForNitro(contract: string): string {
  return contract
    .replaceAll('FileFlatContract<', 'import("@mszr/h3-dux").FileFlatContract<')
    .replaceAll('WithFilenameParams<', 'import("@mszr/h3-dux").WithFilenameParams<')
    .replaceAll('FileMethods<', 'import("@mszr/h3-dux").FileMethods<')
}

/** A method-locked file authored with a method map declares methods Nitro can't reach. */
function methodLockMessage(route: H3DuxFileRouteInfo): string {
  const lock = (route.methods as readonly string[]).join(', ')
  return [
    `  "${route.importSpecifier}" is locked to ${lock.toUpperCase()} by its filename, but defineFileRoute declares: ${route.declared.join(', ')}.`,
    `  Nitro only routes ${lock.toUpperCase()} to it, so the other method(s) are unreachable.`,
    `  Fix: move the body of each method into its own *.<method>.ts file, or rename this to an unsuffixed catch-all.`,
  ].join('\n')
}

/** A shared all-method handler can't carry a body — bodies are method-specific. */
function sharedBodyMessage(route: H3DuxFileRouteInfo): string {
  return [
    `  "${route.importSpecifier}" is an unsuffixed (all-method) file but its flat handler declares validate.body.`,
    `  A request body is method-specific, so a shared handler can't own one.`,
    `  Fix: use the method map form ({ post: { validate: { body } } }) or lock the file to a method (*.post.ts).`,
  ].join('\n')
}

/** A flat file locked to a GET/HEAD filename can't carry a body — those methods are bodyless. */
function bodylessBodyMessage(route: H3DuxFileRouteInfo, method: string): string {
  return [
    `  "${route.importSpecifier}" is locked to ${method.toUpperCase()} by its filename but its flat handler declares validate.body.`,
    `  ${method.toUpperCase()} requests are bodyless, so the body would never arrive.`,
    `  Fix: drop validate.body, or move this to a method that accepts a body (e.g. *.post.ts).`,
  ].join('\n')
}

/** Build one route's `{ method: contract }` entry lines (or push a diagnostic). */
function entriesFor(route: H3DuxFileRouteInfo, diagnostics: string[]): Record<string, string> {
  const ref = handlerRef(route.importSpecifier)
  const fp = paramsLiteral(route.routePath)
  const entries: Record<string, string> = {}
  const isCatchAll = route.methods === 'all'

  if (route.form === 'flat') {
    // Each method gets the flat source re-keyed to it: a `*.head.ts` projects empty,
    // a `*.get.ts` keeps GET semantics — one authored handler, honest per method.
    const flatFor = (method: string): string => `FileFlatContract<${ref}, '${method}', ${fp}>`
    if (isCatchAll) {
      if (route.flatHasBody)
        diagnostics.push(sharedBodyMessage(route))
      for (const method of SHARED_METHODS)
        entries[method] = flatFor(method)
    }
    else {
      for (const method of route.methods as readonly string[]) {
        const lower = method.toLowerCase()
        if (route.flatHasBody && BODYLESS_METHODS.has(lower))
          diagnostics.push(bodylessBodyMessage(route, lower))
        entries[lower] = flatFor(lower)
      }
    }
    return entries
  }

  // Method-map form.
  if (!isCatchAll) {
    const locked = (route.methods as readonly string[]).map(method => method.toLowerCase())
    const unreachable = route.declared.filter(method => !locked.includes(method))
    if (unreachable.length > 0) {
      diagnostics.push(methodLockMessage(route))
      return entries
    }
  }
  for (const method of route.declared)
    entries[method] = `WithFilenameParams<FileMethods<${ref}>['${method}'], ${fp}>`
  return entries
}

/**
 * Generate the `#h3-dux/routes` module source from collected dux file routes. A
 * route+method declared by two files is a diagnostic (first-wins is silent drift);
 * a per-file `Expect<AssertFileRoute<…>>` carries the params/filename agreement into
 * the project typecheck.
 */
export function generateRoutesModule(routes: readonly H3DuxFileRouteInfo[]): GenerateResult {
  const diagnostics: string[] = []
  // path → method → contract source.
  const map = new Map<string, Map<string, string>>()

  for (const route of routes) {
    const entries = entriesFor(route, diagnostics)
    const byMethod = map.get(route.routePath) ?? new Map<string, string>()
    for (const [method, contract] of Object.entries(entries)) {
      if (byMethod.has(method)) {
        diagnostics.push(`  ${route.routePath} declares ${method.toUpperCase()} more than once across files — remove the duplicate.`)
        continue
      }
      byMethod.set(method, contract)
    }
    map.set(route.routePath, byMethod)
  }

  const body = [...map.entries()]
    .filter(([, methods]) => methods.size > 0)
    .map(([path, methods]) => {
      const lines = [...methods.entries()].map(([method, contract]) => `    '${method}': ${contract}`)
      return `  '${path}': {\n${lines.join('\n')}\n  }`
    })
    .join('\n')

  const assertions = routes.map((route, index) =>
    `type _Assert${index} = Expect<AssertFileRoute<${handlerRef(route.importSpecifier)}, ${paramsLiteral(route.routePath)}, '${route.form}'>> // ${route.importSpecifier}`,
  )

  const source = [
    '// Generated by @mszr/h3-dux — do not edit.',
    'import type { AssertFileRoute, Expect, FileFlatContract, FileMethods, WithFilenameParams } from \'@mszr/h3-dux\'',
    '',
    'export interface Routes {',
    body,
    '}',
    '',
    '// Filename-truth assertions — a params schema disagreeing with the path fails typecheck here.',
    ...assertions,
    '',
  ].join('\n')

  return { source, diagnostics }
}

/**
 * Generate the method type strings used to rewrite Nitro's `InternalApi` for dux
 * file routes. This is the non-OpenAPI half of Nitro parity: `$fetch` should read
 * the same success projection as `createClient<Routes>()`, instead of falling back
 * to the raw `ReturnType` of the self-dispatching handler.
 */
export function generateNitroRouteTypes(routes: readonly H3DuxFileRouteInfo[]): NitroRouteTypesResult {
  const diagnostics: string[] = []
  const map = new Map<string, Map<string, string>>()

  for (const route of routes) {
    const entries = entriesFor(route, diagnostics)
    const byMethod = map.get(route.routePath) ?? new Map<string, string>()
    for (const [method, contract] of Object.entries(entries)) {
      if (byMethod.has(method)) {
        diagnostics.push(`  ${route.routePath} declares ${method.toUpperCase()} more than once across files — remove the duplicate.`)
        continue
      }
      byMethod.set(method, `import("@mszr/h3-dux").NitroDataOf<${qualifyForNitro(contract)}>`)
    }
    map.set(route.routePath, byMethod)
  }

  return {
    diagnostics,
    entries: [...map.entries()]
      .filter(([, methods]) => methods.size > 0)
      .map(([routePath, methods]) => ({
        routePath,
        methods: Object.fromEntries(methods),
      })),
  }
}
