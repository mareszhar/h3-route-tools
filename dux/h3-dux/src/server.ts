import type { H3Event, H3Plugin, Middleware } from 'h3'
import type { H3DuxAppConfig } from './h3-app.ts'
import type {
  H3DuxMeta,
  H3DuxOpenAPI,
  H3DuxOpenAPIObject,
} from './internal/openapi-types.ts'
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
import type { OnValidationError, SchemaWithJSON } from './internal/schema-types.ts'
import type {
  BindingsOf,
  InlineCallback,
  InlineSpec,
  InlineSpecIssue,
  TypedMiddleware,
  UnsatisfiedKeys,
  UsableMiddleware,
} from './middleware.ts'
import type {
  MethodValidate,
  RouteMethod,
  RoutePlugin,
} from './route.ts'
import type { H3DuxRouter } from './router.ts'
import type { InferRoutes } from './routes.ts'
import { H3DuxApp } from './h3-app.ts'
import { mergeOpenAPI } from './internal/openapi-types.ts'
import { buildMethod } from './internal/runtime.ts'
import { middlewareOpenAPI, toMiddleware } from './middleware.ts'
import { recordOpenAPIRoute } from './openapi.ts'
import { routerEntries } from './router.ts'

/** The server type after adding one route+method — accumulates into `typeof app`. */
type H3DuxNext<
  Routes,
  Bindings,
  Route extends string,
  M extends RouteMethod,
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Status extends number | undefined,
  Err,
> = H3DuxServer<Prettify<MergePair<Routes, H3DuxRouteRecord<Route, M, V, P, Ret, Status, Err>>>, Bindings>

/** Prefix every key of a router's route map with a static outer mount prefix. */
type PrefixRoutes<Outer extends string, RR> = Outer extends ''
  ? RR
  : { [K in keyof RR as JoinPath<Outer, K & string>]: RR[K] }

/** Route+method collisions between an existing server map and an incoming router. */
type RouteCollisions<A, B> = {
  [P in Extract<keyof A, keyof B>]:
  [Extract<keyof A[P], keyof B[P]>] extends [never] ? never : P
}[Extract<keyof A, keyof B>]

type NoRouteCollisions<Existing, Incoming> = [RouteCollisions<Existing, Incoming>] extends [never]
  ? unknown
  : { '⚠ mounted route + method is already defined': RouteCollisions<Existing, Incoming> }

/**
 * Guard a `.mount(router)`: the router passes through unless it `.requires(...)`
 * a binding the server has not provided, in which case the *expected* type gains
 * an unsatisfiable property and the missing requirement is named at the cursor.
 */
type RequireSatisfied<Requires, Bindings> = [UnsatisfiedKeys<Requires, Bindings>] extends [never]
  ? unknown
  : { '⚠ mount is missing a required binding the router depends on': UnsatisfiedKeys<Requires, Bindings> }

type RouterPathParamNames<RR> = keyof RR extends infer Route extends string
  ? PathParamNames<Route>
  : never

type ParentParamIssue<Outer extends string, RR, ParentParams>
  = | Exclude<keyof ParentParams, PathParamNames<Outer>>
    | Exclude<PathParamNames<Outer>, keyof ParentParams>
    | Extract<keyof ParentParams, RouterPathParamNames<RR>>

type ParentParamsSatisfied<Outer extends string, RR, ParentParams>
  = [ParentParamIssue<Outer, RR, ParentParams>] extends [never]
    ? unknown
    : { '⚠ dynamic outer params must exactly match parentParams and not duplicate child params': ParentParamIssue<Outer, RR, ParentParams> }

/** Join an optional outer mount prefix and an already-prefixed router route. */
function joinMountedPath(outer: string, route: string): string {
  if (!outer)
    return route
  if (route === '/')
    return outer
  return `${outer}${route}`
}

/** Loose runtime view of a verb's options, for the dispatch boundary. */
interface RuntimeOpts {
  params?: SchemaWithJSON
  middleware?: Middleware[]
  // `requires` is type-only (delta 12): it consumes a capability, registers nothing.
  requires?: unknown
  meta?: H3DuxMeta
  openapi?: H3DuxOpenAPI
  status?: number
  onValidationError?: OnValidationError
  errors?: ErrorsOption
  validate?: AnyMethodValidate & { eager?: boolean }
  handler: (event: H3Event) => unknown
}

type RouteCall = (def: Record<string, unknown>, options?: unknown) => unknown

/** Normalize a verb argument (options object *or* a bare handler) to runtime options. */
function toRuntimeOpts(arg: unknown): RuntimeOpts {
  return typeof arg === 'function'
    ? { handler: arg as (event: H3Event) => unknown }
    : arg as RuntimeOpts
}

/**
 * Split a verb's flattened options into the owned route/method def and mount it.
 * The per-method execution — validation mode, SSE, response kinds, the dux event
 * layer — is built once in {@link buildMethod} and shared with Nitro file routes.
 */
function mount(app: H3DuxApp, method: RouteMethod, route: string, options: RuntimeOpts): void {
  const { params, middleware, meta, openapi } = options
  const built = buildMethod(method, options)
  ;(app.route as RouteCall)({
    route,
    params,
    middleware,
    meta: { ...meta, openapi: mergeOpenAPI(meta?.openapi, openapi) },
    [method]: built,
  })
}

function middlewareDocs(middleware: readonly Middleware[] | undefined): Array<H3DuxOpenAPI | undefined> {
  return (middleware ?? []).map(middlewareOpenAPI)
}

function routeDocs(inherited: readonly H3DuxOpenAPI[], options: RuntimeOpts): H3DuxOpenAPIObject | undefined {
  return mergeOpenAPI(...inherited, ...middlewareDocs(options.middleware), options.meta?.openapi, options.openapi)
}

/** The per-verb options a `H3DuxServer<Routes, Bindings>` accepts. */
type ServerOpts<
  Bindings,
  Route extends string,
  M extends RouteMethod,
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Status extends number | undefined,
  Err extends ErrorsOption | undefined,
  Mw extends readonly Middleware[],
  Req extends readonly TypedMiddleware<any, any>[],
> = H3DuxVerbOpts<V, P, M, Ret, Route, Status, Err, Bindings, object, Mw, Req>

/**
 * What a verb method accepts: the full options object **or** a bare handler when
 * defaults suffice (`app.get('/x', e => …)`). It is one *signature* with a union
 * parameter — not two overloads — so a bad options object still reports a single
 * diagnostic at the cursor instead of the "No overload matches" wall (delta 6).
 * The bare-handler arm fixes the validate/params/status/errors to their defaults
 * and infers only the response from the handler's return.
 */
type VerbArg<
  Bindings,
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
  = | ServerOpts<Bindings, Route, M, V, P, Ret, Status, Err, Mw, Req>
    | MethodHandler<MethodValidate, undefined, Ret, Route, M, undefined, undefined, Bindings, object>

/**
 * The dux server: a typed route builder around the owned h3-backed accumulator. Author with
 * per-verb methods (`app.get(path, opts)`) that read symmetrically with the
 * client and infer the response from the handler when no `validate.response` is
 * declared. The accumulated `typeof app` is the single source of truth a
 * `createClient<typeof app>()` reads.
 *
 * It is a thin wrapper (not an `H3` subclass) so the verb names never collide
 * with h3's own `app.get(path, handler)` routing. The underlying app is exposed
 * as `.native` for native h3 (`.on`, `.route`, plugins) when you need it.
 *
 * `Bindings` accumulates the typed capabilities published by middleware added
 * with `.use(...)` (delta 12); each handler's `event.bindings` reads it. Domains
 * compose through routers — `.mount(createRouter('/fruits')…)` (delta 11).
 */
export class H3DuxServer<Routes = object, Bindings = object> {
  /** Type-only marker carrying the accumulated route map; read by `createClient`. */
  declare readonly '~duxRoutes': Routes

  /** The underlying h3 app — the escape hatch for native h3 and `.route(...)`. */
  readonly native: H3DuxApp

  /** Web-standard fetch handler — `serve(app)` or `serve({ fetch: app.fetch })`. */
  readonly fetch: (request: Request) => Response | Promise<Response>

  /** In-process request, for a typed client hitting the app directly. */
  readonly request: (input: string, init?: RequestInit) => Response | Promise<Response>

  readonly #openapi: H3DuxOpenAPI[] = []

  constructor(config?: H3DuxAppConfig) {
    this.native = new H3DuxApp(config)
    this.fetch = request => this.native.fetch(request)
    this.request = (input, init) => this.native.request(input, init)
  }

  /**
   * Register middleware (chainable). Three forms, one method:
   *  - a bare `(event, next) => …` callback — the inline equivalent of
   *    `defineMiddleware(fn)`, no wrap; `event.bindings` is typed from the chain;
   *  - an inline `{ staged, bindings, handler }` object — publishes typed bindings;
   *  - a {@link TypedMiddleware} from `defineMiddleware` — publishes its bindings.
   *
   * The bare-callback overload is first so an unwrapped arrow gets its `event`/`next`
   * typed (not implicit-`any`); a branded provider or an object routes to the
   * bindings-accumulating overloads. Two providers may not publish the same binding
   * key — the collision is a cursor error. This is how auth attaches.
   */
  use(middleware: InlineCallback<Bindings>): this
  use<M extends TypedMiddleware<any, any>>(
    middleware: UsableMiddleware<M, Bindings>,
  ): H3DuxServer<Routes, Prettify<Bindings & BindingsOf<M>>>
  use<
    const Req extends readonly TypedMiddleware<any, any>[] = [],
    Staged = undefined,
    B extends object = object,
  >(
    spec: InlineSpec<Bindings, Req, Staged, B> & InlineSpecIssue<Bindings, Req, B>,
  ): H3DuxServer<Routes, Prettify<Bindings & B>>
  use(route: string, handler: Middleware, opts?: unknown): this
  use(...args: unknown[]): unknown {
    if (typeof args[0] === 'string') {
      (this.native.use as (r: string, h: Middleware, o?: unknown) => unknown)(args[0], toMiddleware(args[1] as Middleware), args[2])
    }
    else {
      const docs = middlewareOpenAPI(args[0])
      if (docs)
        this.#openapi.push(docs)
      this.native.use(toMiddleware(args[0] as Middleware))
    }
    return this
  }

  /**
   * Mount a router (delta 11): fold its routes — each already carrying its domain
   * prefix — into `typeof app`, optionally under a static outer prefix for
   * versioning or deployment structure. A router that `.requires(...)` a binding
   * the server has not provided is rejected at the cursor.
   */
  mount<RR, Req, PP>(
    router: H3DuxRouter<any, RR, any, Req, PP>
      & RequireSatisfied<Req, Bindings>
      & ParentParamsSatisfied<'', RR, PP>
      & NoRouteCollisions<Routes, RR>,
  ): H3DuxServer<Prettify<MergePair<Routes, RR>>, Bindings>
  mount<Outer extends string, RR, Req, PP>(
    outerPrefix: Outer,
    router: H3DuxRouter<any, RR, any, Req, PP>
      & RequireSatisfied<Req, Bindings>
      & ParentParamsSatisfied<Outer, RR, PP>
      & NoRouteCollisions<Routes, PrefixRoutes<Outer, RR>>,
  ): H3DuxServer<Prettify<MergePair<Routes, PrefixRoutes<Outer, RR>>>, Bindings>
  mount(first: unknown, second?: unknown): unknown {
    const outer = typeof first === 'string' ? first : ''
    const router = (typeof first === 'string' ? second : first) as H3DuxRouter
    for (const entry of routerEntries(router)) {
      const route = joinMountedPath(outer, entry.route)
      const options = entry.options as unknown as RuntimeOpts
      mount(this.native, entry.method, route, options)
      recordOpenAPIRoute(this, {
        route,
        method: entry.method,
        params: options.params,
        validate: options.validate,
        status: options.status,
        errors: options.errors,
        openapi: routeDocs(this.#openapi, options),
      })
    }
    return this
  }

  /**
   * Register an h3 plugin (chainable). A `defineRoute` route-plugin also
   * folds its routes into `typeof app`, so the escape hatch never desyncs the
   * client's type; any other plugin behaves as in base h3.
   */
  register<P extends RoutePlugin>(
    plugin: P & NoRouteCollisions<Routes, InferRoutes<P>>,
  ): H3DuxServer<Prettify<MergePair<Routes, InferRoutes<P>>>, Bindings>
  register(plugin: H3Plugin & { readonly '~routePlugin'?: never }): this
  register(plugin: H3Plugin): unknown {
    this.native.register(plugin)
    return this
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
  >(route: DuplicateRoute<Routes, 'get', Route>,
    opts: VerbArg<Bindings, Route, 'get', V, P, Ret, Status, Err, Mw, Req>,
  ): H3DuxNext<Routes, Bindings, Route, 'get', V, P, Ret, Status, Err> {
    const options = toRuntimeOpts(opts)
    mount(this.native, 'get', route, options)
    recordOpenAPIRoute(this, { route, method: 'get', params: options.params, validate: options.validate, status: options.status, errors: options.errors, openapi: routeDocs(this.#openapi, options) })
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
  >(route: DuplicateRoute<Routes, 'post', Route>,
    opts: VerbArg<Bindings, Route, 'post', V, P, Ret, Status, Err, Mw, Req>,
  ): H3DuxNext<Routes, Bindings, Route, 'post', V, P, Ret, Status, Err> {
    const options = toRuntimeOpts(opts)
    mount(this.native, 'post', route, options)
    recordOpenAPIRoute(this, { route, method: 'post', params: options.params, validate: options.validate, status: options.status, errors: options.errors, openapi: routeDocs(this.#openapi, options) })
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
  >(route: DuplicateRoute<Routes, 'put', Route>,
    opts: VerbArg<Bindings, Route, 'put', V, P, Ret, Status, Err, Mw, Req>,
  ): H3DuxNext<Routes, Bindings, Route, 'put', V, P, Ret, Status, Err> {
    const options = toRuntimeOpts(opts)
    mount(this.native, 'put', route, options)
    recordOpenAPIRoute(this, { route, method: 'put', params: options.params, validate: options.validate, status: options.status, errors: options.errors, openapi: routeDocs(this.#openapi, options) })
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
  >(route: DuplicateRoute<Routes, 'patch', Route>,
    opts: VerbArg<Bindings, Route, 'patch', V, P, Ret, Status, Err, Mw, Req>,
  ): H3DuxNext<Routes, Bindings, Route, 'patch', V, P, Ret, Status, Err> {
    const options = toRuntimeOpts(opts)
    mount(this.native, 'patch', route, options)
    recordOpenAPIRoute(this, { route, method: 'patch', params: options.params, validate: options.validate, status: options.status, errors: options.errors, openapi: routeDocs(this.#openapi, options) })
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
  >(route: DuplicateRoute<Routes, 'delete', Route>,
    opts: VerbArg<Bindings, Route, 'delete', V, P, Ret, Status, Err, Mw, Req>,
  ): H3DuxNext<Routes, Bindings, Route, 'delete', V, P, Ret, Status, Err> {
    const options = toRuntimeOpts(opts)
    mount(this.native, 'delete', route, options)
    recordOpenAPIRoute(this, { route, method: 'delete', params: options.params, validate: options.validate, status: options.status, errors: options.errors, openapi: routeDocs(this.#openapi, options) })
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
  >(route: DuplicateRoute<Routes, 'head', Route>,
    opts: VerbArg<Bindings, Route, 'head', V, P, Ret, Status, Err, Mw, Req>,
  ): H3DuxNext<Routes, Bindings, Route, 'head', V, P, Ret, Status, Err> {
    const options = toRuntimeOpts(opts)
    mount(this.native, 'head', route, options)
    recordOpenAPIRoute(this, { route, method: 'head', params: options.params, validate: options.validate, status: options.status, errors: options.errors, openapi: routeDocs(this.#openapi, options) })
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
  >(route: DuplicateRoute<Routes, 'options', Route>,
    opts: VerbArg<Bindings, Route, 'options', V, P, Ret, Status, Err, Mw, Req>,
  ): H3DuxNext<Routes, Bindings, Route, 'options', V, P, Ret, Status, Err> {
    const options = toRuntimeOpts(opts)
    mount(this.native, 'options', route, options)
    recordOpenAPIRoute(this, { route, method: 'options', params: options.params, validate: options.validate, status: options.status, errors: options.errors, openapi: routeDocs(this.#openapi, options) })
    return this as never
  }
}

/**
 * Create a typed h3 server. The counterpart of `createClient`: the server you
 * build here is the single source of truth the client is typed from
 * (`createClient<typeof app>()`). See docs/dux-patterns.md §2.
 */
export function createServer(config?: H3DuxAppConfig): H3DuxServer {
  return new H3DuxServer(config)
}
