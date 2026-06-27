/**
 * Delta-aware composition (delta 11). A `createRouter(prefix?)` is a route group
 * that carries *every* dux delta — verb authoring, validation modes, `sse()`,
 * response/param inference, typed errors, typed middleware bindings — and
 * accumulates a route map without mounting it. A `createServer().mount(router)`
 * folds that map into `typeof app`, so splitting a domain into its own file keeps
 * the full h3-dux surface. See docs/dux-patterns.md §9.
 *
 * The optional literal prefix belongs to the domain: it is prepended to each
 * endpoint path and participates in param inference, so `createRouter('/users/:userId')`
 * types `event.params.userId` in every child handler and the client sees one flat
 * route map. `parentParams` is the escape hatch for the uncommon case where a
 * dynamic outer mount owns a segment the router consumes.
 */
import type { Middleware } from 'h3'
import type { H3DuxOpenAPI } from './internal/openapi-types.ts'
import type {
  AnyMethodValidate,
  DuplicateRoute,
  ErrorsOption,
  H3DuxRouteRecord,
  H3DuxVerbOpts,
  InferMethodResponse,
  JoinPath,
  MergePair,
  MethodHandler,
  PathParamNames,
  Prettify,
} from './internal/route-types.ts'
import type { SchemaWithJSON } from './internal/schema-types.ts'
import type {
  BindingsOf,
  InlineCallback,
  InlineSpec,
  InlineSpecIssue,
  TypedMiddleware,
  UsableMiddleware,
} from './middleware.ts'
import type {
  MethodValidate,
  RouteMethod,
} from './route.ts'
import { mergeOpenAPI } from './internal/openapi-types.ts'
import { toMiddleware } from './middleware.ts'

/** A recorded, not-yet-mounted endpoint: its method, full (prefix-joined) path, and options. */
interface RouterEntry {
  method: RouteMethod
  route: string
  options: { middleware?: Middleware[] } & Record<string, unknown>
}

interface RouterState {
  prefix: string
  openapi?: H3DuxOpenAPI
  middlewares: Middleware[]
  entries: RouterEntry[]
}

/** Runtime records stay out of the public router surface and its completions. */
const ROUTER_STATE = new WeakMap<object, RouterState>()

function stateOf(router: object): RouterState {
  const state = ROUTER_STATE.get(router)
  if (!state)
    throw new TypeError('Invalid h3-dux router')
  return state
}

/** Internal replay boundary consumed by `H3DuxServer.mount`; not exported by the package. */
export function routerEntries(router: H3DuxRouter): readonly RouterEntry[] {
  return stateOf(router).entries
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
> = H3DuxVerbOpts<V, P, M, Ret, JoinPath<Prefix, Route>, Status, Err, Bindings, ParentParams, Mw, Req>

/**
 * What a router verb accepts: the full options object **or** a bare handler when
 * defaults suffice. One signature with a union parameter (not two overloads), so a
 * bad options object stays a single cursor diagnostic — see `VerbArg` in server.ts.
 */
type RouterArg<
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
>
  = | RouterOpts<Bindings, ParentParams, Prefix, Route, M, V, P, Ret, Status, Err, Mw, Req>
    | MethodHandler<MethodValidate, undefined, Ret, JoinPath<Prefix, Route>, M, undefined, undefined, Bindings, ParentParams>

type DuplicateParamNames<Prefix extends string, Route extends string, ParentParams>
  = | Extract<PathParamNames<Prefix>, PathParamNames<Route>>
    | Extract<keyof ParentParams, PathParamNames<JoinPath<Prefix, Route>>>

type RouterRouteArgument<
  Routes,
  M extends RouteMethod,
  Prefix extends string,
  Route extends string,
  ParentParams,
> = [DuplicateParamNames<Prefix, Route, ParentParams>] extends [never]
  ? DuplicateRoute<Routes, M, JoinPath<Prefix, Route>, Route>
  : '⚠ a path param name is duplicated across parent, router prefix, and local route'

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
> = H3DuxRouter<
  Prefix,
  Prettify<MergePair<Routes, H3DuxRouteRecord<JoinPath<Prefix, Route>, M, V, P, Ret, Status, Err, ParentParams>>>,
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
export class H3DuxRouter<
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

  constructor(prefix: Prefix = '' as Prefix, _parentParams: readonly string[] = [], openapi?: H3DuxOpenAPI) {
    ROUTER_STATE.set(this, {
      prefix,
      openapi,
      middlewares: [],
      entries: [],
    })
  }

  /**
   * Register router-scoped middleware (chainable). Identical to a server's
   * `.use(...)` — a bare `(event, next) => …` callback (no `defineMiddleware` wrap;
   * `event.bindings` typed from the chain), an inline `{ staged, bindings, handler }`
   * object, or a {@link TypedMiddleware} — but the registration runs only for this
   * router's routes, the way to give a domain exact runtime scope.
   */
  use(middleware: InlineCallback<Bindings>): this
  use<M extends TypedMiddleware<any, any>>(
    middleware: UsableMiddleware<M, Bindings>,
  ): H3DuxRouter<Prefix, Routes, Prettify<Bindings & BindingsOf<M>>, Requires, ParentParams>
  use<
    const Req extends readonly TypedMiddleware<any, any>[] = [],
    Staged = undefined,
    B extends object = object,
  >(
    spec: InlineSpec<Bindings, Req, Staged, B> & InlineSpecIssue<Bindings, Req, B>,
  ): H3DuxRouter<Prefix, Routes, Prettify<Bindings & B>, Requires, ParentParams>
  use(spec: unknown): unknown {
    stateOf(this).middlewares.push(toMiddleware(spec as Middleware))
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
  ): H3DuxRouter<Prefix, Routes, Prettify<Bindings & BindingsOf<M>>, Prettify<Requires & BindingsOf<M>>, ParentParams> {
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
  >(route: RouterRouteArgument<Routes, 'get', Prefix, Route, ParentParams>,
    opts: RouterArg<Bindings, ParentParams, Prefix, Route, 'get', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'get', V, P, Ret, Status, Err> {
    this.record('get', route, opts)
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
  >(route: RouterRouteArgument<Routes, 'post', Prefix, Route, ParentParams>,
    opts: RouterArg<Bindings, ParentParams, Prefix, Route, 'post', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'post', V, P, Ret, Status, Err> {
    this.record('post', route, opts)
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
  >(route: RouterRouteArgument<Routes, 'put', Prefix, Route, ParentParams>,
    opts: RouterArg<Bindings, ParentParams, Prefix, Route, 'put', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'put', V, P, Ret, Status, Err> {
    this.record('put', route, opts)
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
  >(route: RouterRouteArgument<Routes, 'patch', Prefix, Route, ParentParams>,
    opts: RouterArg<Bindings, ParentParams, Prefix, Route, 'patch', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'patch', V, P, Ret, Status, Err> {
    this.record('patch', route, opts)
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
  >(route: RouterRouteArgument<Routes, 'delete', Prefix, Route, ParentParams>,
    opts: RouterArg<Bindings, ParentParams, Prefix, Route, 'delete', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'delete', V, P, Ret, Status, Err> {
    this.record('delete', route, opts)
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
  >(route: RouterRouteArgument<Routes, 'head', Prefix, Route, ParentParams>,
    opts: RouterArg<Bindings, ParentParams, Prefix, Route, 'head', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'head', V, P, Ret, Status, Err> {
    this.record('head', route, opts)
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
  >(route: RouterRouteArgument<Routes, 'options', Prefix, Route, ParentParams>,
    opts: RouterArg<Bindings, ParentParams, Prefix, Route, 'options', V, P, Ret, Status, Err, Mw, Req>,
  ): RouterNext<Prefix, Routes, Bindings, Requires, ParentParams, Route, 'options', V, P, Ret, Status, Err> {
    this.record('options', route, opts)
    return this as never
  }

  /** Capture the middleware chain exactly as it exists when an endpoint is authored. */
  private record(method: RouteMethod, route: string, opts: unknown): void {
    const state = stateOf(this)
    // A verb accepts an options object or a bare handler — normalize to options.
    const options = (typeof opts === 'function' ? { handler: opts } : opts) as RouterEntry['options']
    state.entries.push({
      method,
      route: joinPath(state.prefix, route),
      options: {
        ...options,
        openapi: mergeOpenAPI(state.openapi, options.openapi as H3DuxOpenAPI | undefined),
        middleware: [...state.middlewares, ...(options.middleware ?? [])],
      },
    })
  }
}

/** Options for `createRouter` — the dynamic-outer-mount escape hatch. */
interface RouterOptions<ParentParams extends readonly string[]> {
  /** Param names a *dynamic* outer mount owns and supplies to this router (delta 11). */
  parentParams?: ParentParams
  /** OpenAPI metadata inherited by routes authored inside this router. */
  openapi?: H3DuxOpenAPI
}

/**
 * Create a delta-aware router. `createRouter('/fruits')` owns that domain prefix;
 * `createRouter()` is prefix-free. The counterpart to `createServer` for grouping:
 * author with the same verbs, then `createServer().mount(router)`.
 */
export function createRouter(): H3DuxRouter<''>
export function createRouter<const Prefix extends string>(prefix: Prefix): H3DuxRouter<Prefix>
export function createRouter<const Prefix extends string>(
  prefix: Prefix,
  options: { openapi: H3DuxOpenAPI },
): H3DuxRouter<Prefix>
export function createRouter<const Prefix extends string, const PP extends readonly string[]>(
  prefix: Prefix,
  options: RouterOptions<PP> & { parentParams: PP },
): H3DuxRouter<Prefix, object, object, object, Record<PP[number], string>>
export function createRouter(
  prefix = '',
  options?: RouterOptions<readonly string[]>,
): H3DuxRouter<string> {
  return new H3DuxRouter(prefix, options?.parentParams, options?.openapi)
}
