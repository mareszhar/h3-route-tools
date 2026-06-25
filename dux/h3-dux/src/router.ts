/**
 * Delta-aware composition (delta 11). A `createRouter(prefix?)` is a route group
 * that carries *every* dux delta — verb authoring, validation modes, `sse()`,
 * response/param inference, typed errors, typed middleware bindings — and
 * accumulates a route map without mounting it. A `createServer().mount(router)`
 * folds that map into `typeof app`, so splitting a domain into its own file never
 * drops you back to upstream ergonomics. See docs/dux-conventions.md §12.
 *
 * The optional literal prefix belongs to the domain: it is prepended to each
 * endpoint path and participates in param inference, so `createRouter('/users/:userId')`
 * types `event.params.userId` in every child handler and the client sees one flat
 * route map. `parentParams` is the escape hatch for the uncommon case where a
 * dynamic outer mount owns a segment the router consumes.
 */
import type { Middleware } from 'h3'
import type {
  MethodValidate,
  RouteMethod,
  SchemaWithJSON,
} from 'h3-route-tools'
import type {
  AnyMethodValidate,
  DuplicateRoute,
  DuxRouteRecord,
  DuxVerbOpts,
  ErrorsOption,
  InferMethodResponse,
  JoinPath,
  MergePair,
  Prettify,
} from './internal/route-types.ts'
import type {
  BindingsOf,
  InlineSpec,
  NoConflict,
  PlainMiddleware,
  TypedMiddleware,
} from './middleware.ts'
import { toMiddleware } from './middleware.ts'

/** A recorded, not-yet-mounted endpoint: its method, full (prefix-joined) path, and options. */
interface RouterEntry {
  method: RouteMethod
  route: string
  options: { middleware?: Middleware[] } & Record<string, unknown>
}

/** Join a router prefix and a local route at runtime (`'/'` is the prefix root). */
function joinPath(prefix: string, local: string): string {
  if (local === '/')
    return prefix || '/'
  return `${prefix}${local}`
}

/** The per-verb options a router accepts: the full-path (prefixed) request contract. */
type RouterOpts<
  Bindings,
  ParentParams,
  Prefix extends string,
  Route extends string,
  M extends RouteMethod,
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Status extends number | undefined,
  Err extends ErrorsOption | undefined,
  Mw extends readonly Middleware[],
  Req extends readonly TypedMiddleware<any, any>[],
> = DuxVerbOpts<V, P, M, Ret, JoinPath<Prefix, Route>, Status, Err, Bindings, ParentParams, Mw, Req>

/** The router type after adding one route+method — keyed by the full, prefixed path. */
type RouterNext<
  Prefix extends string,
  Routes,
  Bindings,
  Requires,
  ParentParams,
  Route extends string,
  M extends RouteMethod,
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Status extends number | undefined,
  Err,
> = DuxRouter<
  Prefix,
  Prettify<MergePair<Routes, DuxRouteRecord<JoinPath<Prefix, Route>, M, V, P, Ret, Status, Err, ParentParams>>>,
  Bindings,
  Requires,
  ParentParams
>

/**
 * A delta-aware route group. Author it exactly like a server (same verbs, same
 * options), then `mount` it. `Prefix` is its domain path; `Bindings` are the
 * capabilities its own `.use(...)` publishes; `Requires` are the parent
 * capabilities it depends on via `.requires(...)` (checked at the mount cursor);
 * `ParentParams` are params a dynamic outer mount owns (`parentParams`).
 */
export class DuxRouter<
  Prefix extends string = '',
  Routes = object,
  Bindings = object,
  Requires = object,
  ParentParams = object,
> {
  /** Type-only marker carrying the accumulated route map; read on `mount`. */
  declare readonly '~duxRoutes': Routes
  /** Type-only markers carrying the published bindings and external requirements. */
  declare readonly '~bindings': Bindings
  declare readonly '~requires': Requires

  readonly prefix: Prefix
  /** Names a dynamic outer mount must supply (the `parentParams` escape hatch). */
  readonly parentParams: readonly string[]
  /** Router-scoped middleware, prepended to every endpoint when mounted. */
  readonly middlewares: Middleware[] = []
  /** The recorded endpoints, mounted verbatim by `createServer().mount(this)`. */
  readonly entries: RouterEntry[] = []

  constructor(prefix: Prefix = '' as Prefix, parentParams: readonly string[] = []) {
    this.prefix = prefix
    this.parentParams = parentParams
  }

  /**
   * Register router-scoped middleware (chainable). Identical to a server's
   * `.use(...)` but the registration runs only for this router's routes — the way
   * to give a domain exact runtime scope. Typed middleware publishes `event.bindings`.
   */
  use<M extends TypedMiddleware<any, any>>(
    middleware: NoConflict<M, Bindings>,
  ): DuxRouter<Prefix, Routes, Prettify<Bindings & BindingsOf<M>>, Requires, ParentParams>
  use<Staged, B extends object>(
    spec: InlineSpec<Bindings, Staged, B>,
  ): DuxRouter<Prefix, Routes, Prettify<Bindings & B>, Requires, ParentParams>
  use(middleware: PlainMiddleware): this
  use(spec: unknown): unknown {
    this.middlewares.push(toMiddleware(spec as Middleware))
    return this
  }

  /**
   * Depend on a parent capability *without* registering it (delta 12). Types this
   * router's handlers with the provider's bindings and records an external
   * requirement that `createServer().mount(this)` checks — the parent must already
   * provide it, or the mount is a cursor error. It executes nothing here.
   */
  requires<M extends TypedMiddleware<any, any>>(
    _provider: M,
  ): DuxRouter<Prefix, Routes, Prettify<Bindings & BindingsOf<M>>, Prettify<Requires & BindingsOf<M>>, ParentParams> {
    return this as never
  }

  get<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
    const Status extends number | undefined = undefined,
    Err extends ErrorsOption | undefined = undefined,
    const Mw extends readonly Middleware[] = [],
    const Req extends readonly TypedMiddleware<any, any>[] = [],
  >(route: DuplicateRoute<Routes, 'get', JoinPath<Prefix, Route>, Route>,
    opts: RouterOpts<Bindings, ParentParams, Prefix, Route, 'get', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'get', V, P, Ret, Status, Err> {
    this.entries.push({ method: 'get', route: joinPath(this.prefix, route), options: opts as unknown as RouterEntry['options'] })
    return this as never
  }

  post<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
    const Status extends number | undefined = undefined,
    Err extends ErrorsOption | undefined = undefined,
    const Mw extends readonly Middleware[] = [],
    const Req extends readonly TypedMiddleware<any, any>[] = [],
  >(route: DuplicateRoute<Routes, 'post', JoinPath<Prefix, Route>, Route>,
    opts: RouterOpts<Bindings, ParentParams, Prefix, Route, 'post', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'post', V, P, Ret, Status, Err> {
    this.entries.push({ method: 'post', route: joinPath(this.prefix, route), options: opts as unknown as RouterEntry['options'] })
    return this as never
  }

  put<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
    const Status extends number | undefined = undefined,
    Err extends ErrorsOption | undefined = undefined,
    const Mw extends readonly Middleware[] = [],
    const Req extends readonly TypedMiddleware<any, any>[] = [],
  >(route: DuplicateRoute<Routes, 'put', JoinPath<Prefix, Route>, Route>,
    opts: RouterOpts<Bindings, ParentParams, Prefix, Route, 'put', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'put', V, P, Ret, Status, Err> {
    this.entries.push({ method: 'put', route: joinPath(this.prefix, route), options: opts as unknown as RouterEntry['options'] })
    return this as never
  }

  patch<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
    const Status extends number | undefined = undefined,
    Err extends ErrorsOption | undefined = undefined,
    const Mw extends readonly Middleware[] = [],
    const Req extends readonly TypedMiddleware<any, any>[] = [],
  >(route: DuplicateRoute<Routes, 'patch', JoinPath<Prefix, Route>, Route>,
    opts: RouterOpts<Bindings, ParentParams, Prefix, Route, 'patch', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'patch', V, P, Ret, Status, Err> {
    this.entries.push({ method: 'patch', route: joinPath(this.prefix, route), options: opts as unknown as RouterEntry['options'] })
    return this as never
  }

  delete<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
    const Status extends number | undefined = undefined,
    Err extends ErrorsOption | undefined = undefined,
    const Mw extends readonly Middleware[] = [],
    const Req extends readonly TypedMiddleware<any, any>[] = [],
  >(route: DuplicateRoute<Routes, 'delete', JoinPath<Prefix, Route>, Route>,
    opts: RouterOpts<Bindings, ParentParams, Prefix, Route, 'delete', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'delete', V, P, Ret, Status, Err> {
    this.entries.push({ method: 'delete', route: joinPath(this.prefix, route), options: opts as unknown as RouterEntry['options'] })
    return this as never
  }

  head<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
    const Status extends number | undefined = undefined,
    Err extends ErrorsOption | undefined = undefined,
    const Mw extends readonly Middleware[] = [],
    const Req extends readonly TypedMiddleware<any, any>[] = [],
  >(route: DuplicateRoute<Routes, 'head', JoinPath<Prefix, Route>, Route>,
    opts: RouterOpts<Bindings, ParentParams, Prefix, Route, 'head', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'head', V, P, Ret, Status, Err> {
    this.entries.push({ method: 'head', route: joinPath(this.prefix, route), options: opts as unknown as RouterEntry['options'] })
    return this as never
  }

  options<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
    const Status extends number | undefined = undefined,
    Err extends ErrorsOption | undefined = undefined,
    const Mw extends readonly Middleware[] = [],
    const Req extends readonly TypedMiddleware<any, any>[] = [],
  >(route: DuplicateRoute<Routes, 'options', JoinPath<Prefix, Route>, Route>,
    opts: RouterOpts<Bindings, ParentParams, Prefix, Route, 'options', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'options', V, P, Ret, Status, Err> {
    this.entries.push({ method: 'options', route: joinPath(this.prefix, route), options: opts as unknown as RouterEntry['options'] })
    return this as never
  }
}

/** Options for `createRouter` — the dynamic-outer-mount escape hatch. */
interface RouterOptions<ParentParams extends readonly string[]> {
  /** Param names a *dynamic* outer mount owns and supplies to this router (delta 11). */
  parentParams: ParentParams
}

/**
 * Create a delta-aware router. `createRouter('/fruits')` owns that domain prefix;
 * `createRouter()` is prefix-free. The counterpart to `createServer` for grouping:
 * author with the same verbs, then `createServer().mount(router)`.
 */
export function createRouter(): DuxRouter<''>
export function createRouter<const Prefix extends string>(prefix: Prefix): DuxRouter<Prefix>
export function createRouter<const Prefix extends string, const PP extends readonly string[]>(
  prefix: Prefix,
  options: RouterOptions<PP>,
): DuxRouter<Prefix, object, object, object, Record<PP[number], string>>
export function createRouter(
  prefix = '',
  options?: RouterOptions<readonly string[]>,
): DuxRouter<string> {
  return new DuxRouter(prefix, options?.parentParams)
}

/** Prefix-free alias of {@link createRouter} for a flat group of routes. */
export function defineRoutes(): DuxRouter<''> {
  return new DuxRouter('')
}
