/**
 * Nitro codegen for dux file routes (delta 13, step 9C). Pure string generation,
 * kept apart from the Nitro module (`nitro.ts`) so it is unit-testable without a
 * Nitro build. It turns each collected dux file handler — its filename-derived
 * path/method (Nitro's route table is the truth) and its authoring form — into one
 * `#h3-dux/routes` entry, projecting the handler's kernel through the type-only
 * `FlatContract`/`FileMethods`/`WithFilenameParams` helpers so the result stays
 * schema-free and re-links to source on every regenerate.
 *
 * Generation also rejects the runtime-inspectable contradictions the spec lists:
 * a method-locked file authored as a method map (unreachable methods) and a shared
 * all-method handler that declares a body (bodies are method-specific).
 */

/** The methods Nitro routes to a file: an explicit list (`*.post.ts`) or `'all'` (catch-all). */
export type NitroMethods = readonly string[] | 'all'

/** One collected dux file route — the codegen input, recovered from Nitro + the handler. */
export interface DuxFileRouteInfo {
  /** The Nitro-normalized route path, e.g. `/fruits/:id`. */
  routePath: string
  /** The `import('…')` specifier the generated module uses for this file's `default`. */
  importSpecifier: string
  /** The authoring form, from the handler's runtime marker. */
  form: 'flat' | 'methods'
  /** Method-map: the declared methods; flat: empty. */
  declared: readonly string[]
  /** Flat: whether `validate.body` was declared (illegal for a shared all-method file). */
  flatHasBody: boolean
  /** The methods Nitro routes here (filename truth). */
  methods: NitroMethods
}

/** The result of generation — the module source and any blocking diagnostics. */
export interface GenerateResult {
  source: string
  diagnostics: string[]
}

/** Client-visible methods a shared all-method (catch-all flat) file is projected to. */
const SHARED_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options'] as const
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

/** A method-locked file authored with a method map declares methods Nitro can't reach. */
function methodLockMessage(route: DuxFileRouteInfo): string {
  const lock = (route.methods as readonly string[]).join(', ')
  return [
    `  "${route.importSpecifier}" is locked to ${lock.toUpperCase()} by its filename, but defineFileRoute declares: ${route.declared.join(', ')}.`,
    `  Nitro only routes ${lock.toUpperCase()} to it, so the other method(s) are unreachable.`,
    `  Fix: move the body of each method into its own *.<method>.ts file, or rename this to an unsuffixed catch-all.`,
  ].join('\n')
}

/** A shared all-method handler can't carry a body — bodies are method-specific. */
function sharedBodyMessage(route: DuxFileRouteInfo): string {
  return [
    `  "${route.importSpecifier}" is an unsuffixed (all-method) file but its flat handler declares validate.body.`,
    `  A request body is method-specific, so a shared handler can't own one.`,
    `  Fix: use the method map form ({ post: { validate: { body } } }) or lock the file to a method (*.post.ts).`,
  ].join('\n')
}

/** Build one route's `{ method: contract }` entry lines (or push a diagnostic). */
function entriesFor(route: DuxFileRouteInfo, diagnostics: string[]): Record<string, string> {
  const ref = handlerRef(route.importSpecifier)
  const fp = paramsLiteral(route.routePath)
  const entries: Record<string, string> = {}
  const isCatchAll = route.methods === 'all'

  if (route.form === 'flat') {
    const contract = `WithFilenameParams<FlatContract<${ref}>, ${fp}>`
    if (isCatchAll) {
      if (route.flatHasBody)
        diagnostics.push(sharedBodyMessage(route))
      for (const method of SHARED_METHODS)
        entries[method] = contract
    }
    else {
      // Method-locked flat file — the filename's method is correct and reachable.
      for (const method of route.methods as readonly string[])
        entries[method.toLowerCase()] = contract
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
 * route+method declared by two files is a diagnostic (first-wins is silent drift).
 */
export function generateRoutesModule(routes: readonly DuxFileRouteInfo[]): GenerateResult {
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

  const source = [
    '// Generated by @mszr/h3-dux — do not edit.',
    'import type { FileMethods, FlatContract, WithFilenameParams } from \'@mszr/h3-dux\'',
    '',
    'export interface Routes {',
    body,
    '}',
    '',
  ].join('\n')

  return { source, diagnostics }
}
