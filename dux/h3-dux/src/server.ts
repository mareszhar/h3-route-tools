import type { H3Event, H3Plugin, H3RouteMeta, Middleware } from 'h3'
import type {
  H3TypedConfig,
  InferRoutes,
  MethodValidate,
  OnValidationError,
  RouteMethod,
  RoutePlugin,
  SchemaWithJSON,
  ValidateSource,
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
  PathParamNames,
  Prettify,
} from './internal/route-types.ts'
import type {
  BindingsOf,
  InlineSpec,
  InlineSpecIssue,
  PlainMiddleware,
  TypedMiddleware,
  UnsatisfiedKeys,
  UsableMiddleware,
} from './middleware.ts'
import type { DuxRouter } from './router.ts'
import { createEventStream, getQuery, HTTPError } from 'h3'
import { H3Typed } from 'h3-route-tools'
import { ensureDuxAccessors, toMiddleware } from './middleware.ts'
import {
  isBinaryResponse,
  isTextResponse,
  runtimeResponseKind,
  setResponseKind,
} from './response.ts'
import { routerEntries } from './router.ts'
import { isEventStream } from './sse.ts'

/** The server type after adding one route+method — accumulates into `typeof app`. */
type DuxNext<
  Routes,
  Bindings,
  Route extends string,
  M extends RouteMethod,
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Status extends number | undefined,
  Err,
> = DuxServer<Prettify<MergePair<Routes, DuxRouteRecord<Route, M, V, P, Ret, Status, Err>>>, Bindings>

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
  meta?: H3RouteMeta
  status?: number
  onValidationError?: OnValidationError
  errors?: ErrorsOption
  validate?: AnyMethodValidate & { eager?: boolean }
  handler: (event: H3Event) => unknown
}

type RouteCall = (def: Record<string, unknown>, options?: unknown) => unknown
interface Schemas { query?: SchemaWithJSON, body?: SchemaWithJSON, headers?: SchemaWithJSON }

/** Validate one scope against its schema; throw 422 (or the hook's shape) on failure. */
async function validateScope(
  schema: SchemaWithJSON,
  value: unknown,
  source: ValidateSource,
  event: H3Event,
  onValidationError: OnValidationError | undefined,
): Promise<unknown> {
  const result = await schema['~standard'].validate(value)
  if (result.issues) {
    const details = onValidationError?.({ source, issues: result.issues, event })
    throw new HTTPError(details ?? {
      status: 422,
      statusText: 'Unprocessable Entity',
      message: `${source} validation failed`,
      data: { source, issues: result.issues },
    })
  }
  return result.value
}

/** Read a scope's raw, pre-validation value off the event. */
function readRaw(event: H3Event, scope: string): unknown {
  if (scope === 'query')
    return getQuery(event)
  if (scope === 'body')
    return event.req.json()
  if (scope === 'headers')
    return Object.fromEntries(event.req.headers.entries())
  return event.context.params
}

/** Attach `event.valid(scope)`: idempotent; reads (eager) or runs (manual) the validated value. */
function attachValid(
  event: H3Event,
  eager: boolean,
  schemas: Schemas,
  onValidationError: OnValidationError | undefined,
): void {
  const cache = new Map<string, unknown>()
  const ctx = event.context as Record<string, unknown>
  const validated = (event as { validated?: Record<string, unknown> }).validated

  ;(event as { valid?: unknown }).valid = async (scope: string): Promise<unknown> => {
    if (cache.has(scope))
      return cache.get(scope)
    let value: unknown
    if (scope === 'params') {
      value = event.context.params
    }
    else if (eager) {
      value = scope === 'body' ? await event.req.json() : validated?.[scope] ?? await readRaw(event, scope)
    }
    else {
      const schema = schemas[scope as keyof Schemas]
      const raw = await readRaw(event, scope)
      value = schema ? await validateScope(schema, raw, scope as ValidateSource, event, onValidationError) : raw
      ctx[scope] = value
    }
    cache.set(scope, value)
    return value
  }
}

/** Stream a handler's async iterable as a validated `text/event-stream`. */
function streamSse(
  event: H3Event,
  source: AsyncIterable<unknown>,
  schema: SchemaWithJSON,
  onValidationError: OnValidationError | undefined,
): unknown {
  const stream = createEventStream(event)
  void (async () => {
    try {
      for await (const chunk of source) {
        const tick = await validateScope(schema, chunk, 'response', event, onValidationError)
        await stream.push(JSON.stringify(tick))
      }
    }
    finally {
      await stream.close()
    }
  })()
  return stream.send()
}

/**
 * Split a verb's flattened options into upstream's route/method def and mount it,
 * wiring the validation mode and SSE. Eager (default) lets upstream validate the
 * request and mirrors it onto `event.context`; manual (`eager: false`) defers
 * query/body/headers to `event.valid(...)`. An `sse()` response is streamed here
 * (each yield validated) rather than value-validated by upstream.
 */
function mount(app: H3Typed, method: RouteMethod, route: string, options: RuntimeOpts): void {
  const { params, middleware, meta, status, onValidationError, validate, handler } = options
  const eager = validate?.eager !== false
  const schemas: Schemas = { query: validate?.query, body: validate?.body, headers: validate?.headers }
  const sseSchema = isEventStream(validate?.response) ? (validate?.response as SchemaWithJSON) : undefined
  // Response kinds (delta 10): `text()`/`binary()` carry no schema to value-validate;
  // the server just sends the matching content type so the client decodes by kind.
  const isText = isTextResponse(validate?.response)
  const isBinary = isBinaryResponse(validate?.response)
  // The response schema upstream value-validates (none for streams or kind markers).
  const response = (sseSchema || isText || isBinary) ? undefined : validate?.response
  const upstreamValidate = eager
    ? { query: schemas.query, body: schemas.body, headers: schemas.headers, response }
    : (response ? { response } : undefined)

  // Standardize request-validation failures on 422, eager or manual (delta 9). The
  // user's hook still wins; response failures are re-wrapped to 500 by upstream.
  const onError: OnValidationError = ctx =>
    onValidationError?.(ctx) ?? {
      status: 422,
      statusText: 'Unprocessable Entity',
      message: `${ctx.source} validation failed`,
      data: { source: ctx.source, issues: ctx.issues },
    }

  const wrapped = async (event: H3Event): Promise<unknown> => {
    if (status !== undefined)
      event.res.status = status
    // Install the root aliases (`event.params/query/body/bindings`) over the
    // canonical `event.context` store — idempotent with any middleware that ran.
    ensureDuxAccessors(event)
    attachValid(event, eager, schemas, onError)
    // `throw event.error(status, data)` — a typed thrower for the declared `errors` (delta 9).
    ;(event as { error?: unknown }).error = (errStatus: number, data?: unknown) =>
      new HTTPError({ status: errStatus, data })
    if (eager) {
      const ctx = event.context as Record<string, unknown>
      const validated = (event as { validated?: Record<string, unknown> }).validated
      ctx.query = validated?.query ?? getQuery(event)
      if (schemas.body)
        ctx.body = await event.req.json()
    }
    const result = await handler(event)
    if (sseSchema)
      return streamSse(event, result as AsyncIterable<unknown>, sseSchema, onError)
    if (result instanceof Response) {
      // A typedResponse() already carries kind + MIME. A plain native Response is
      // deliberately opaque and passes through untouched.
      return result
    }

    // The happy path is inferred from the actual handler value. Explicit markers
    // remain useful only when a schema's output is genuinely ambiguous.
    const kind = status === 204 || status === 205 || method === 'head'
      ? 'empty'
      : isText
        ? 'text'
        : isBinary
          ? 'binary'
          : runtimeResponseKind(result)
    if (kind === 'binary' && result instanceof Blob && result.type && !event.res.headers.has('content-type'))
      event.res.headers.set('content-type', result.type)
    if (kind !== 'empty' || (status !== 204 && status !== 205 && method !== 'head'))
      setResponseKind(event.res.headers, kind)
    return result
  }

  ;(app.route as RouteCall)({
    route,
    params,
    middleware,
    meta,
    [method]: { validate: upstreamValidate, handler: wrapped, onValidationError: onError },
  })
}

/** The per-verb options a `DuxServer<Routes, Bindings>` accepts. */
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
> = DuxVerbOpts<V, P, M, Ret, Route, Status, Err, Bindings, object, Mw, Req>

/**
 * The dux server: a typed route builder around upstream's `H3Typed`. Author with
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
export class DuxServer<Routes = object, Bindings = object> {
  /** Type-only marker carrying the accumulated route map; read by `createClient`. */
  declare readonly '~duxRoutes': Routes

  /** The underlying h3 app — the escape hatch for native h3 and `.route(...)`. */
  readonly native: H3Typed

  /** Web-standard fetch handler — `serve(app)` or `serve({ fetch: app.fetch })`. */
  readonly fetch: (request: Request) => Response | Promise<Response>

  /** In-process request, for a typed client hitting the app directly. */
  readonly request: (input: string, init?: RequestInit) => Response | Promise<Response>

  constructor(config?: H3TypedConfig) {
    this.native = new H3Typed(config)
    this.fetch = request => this.native.fetch(request)
    this.request = (input, init) => this.native.request(input, init)
  }

  /**
   * Register middleware (chainable). A {@link TypedMiddleware} from
   * `defineMiddleware` (or an inline `{ staged, bindings, handler }` object)
   * publishes typed `event.bindings` to every route declared after it; a plain
   * `(event, next) => …` works untyped. Two providers may not publish the same
   * binding key — the collision is a cursor error. This is how auth attaches.
   */
  use<M extends TypedMiddleware<any, any>>(
    middleware: UsableMiddleware<M, Bindings>,
  ): DuxServer<Routes, Prettify<Bindings & BindingsOf<M>>>
  use<
    const Req extends readonly TypedMiddleware<any, any>[] = [],
    Staged = undefined,
    B extends object = object,
  >(
    spec: InlineSpec<Bindings, Req, Staged, B> & InlineSpecIssue<Bindings, Req, B>,
  ): DuxServer<Routes, Prettify<Bindings & B>>
  use(middleware: PlainMiddleware): this
  use(route: string, handler: Middleware, opts?: unknown): this
  use(...args: unknown[]): unknown {
    if (typeof args[0] === 'string')
      (this.native.use as (r: string, h: Middleware, o?: unknown) => unknown)(args[0], toMiddleware(args[1] as Middleware), args[2])
    else
      this.native.use(toMiddleware(args[0] as Middleware))
    return this
  }

  /**
   * Mount a router (delta 11): fold its routes — each already carrying its domain
   * prefix — into `typeof app`, optionally under a static outer prefix for
   * versioning or deployment structure. A router that `.requires(...)` a binding
   * the server has not provided is rejected at the cursor.
   */
  mount<RR, Req, PP>(
    router: DuxRouter<any, RR, any, Req, PP>
      & RequireSatisfied<Req, Bindings>
      & ParentParamsSatisfied<'', RR, PP>
      & NoRouteCollisions<Routes, RR>,
  ): DuxServer<Prettify<MergePair<Routes, RR>>, Bindings>
  mount<Outer extends string, RR, Req, PP>(
    outerPrefix: Outer,
    router: DuxRouter<any, RR, any, Req, PP>
      & RequireSatisfied<Req, Bindings>
      & ParentParamsSatisfied<Outer, RR, PP>
      & NoRouteCollisions<Routes, PrefixRoutes<Outer, RR>>,
  ): DuxServer<Prettify<MergePair<Routes, PrefixRoutes<Outer, RR>>>, Bindings>
  mount(first: unknown, second?: unknown): unknown {
    const outer = typeof first === 'string' ? first : ''
    const router = (typeof first === 'string' ? second : first) as DuxRouter
    for (const entry of routerEntries(router)) {
      mount(this.native, entry.method, joinMountedPath(outer, entry.route), entry.options as unknown as RuntimeOpts)
    }
    return this
  }

  /**
   * Register an upstream h3 plugin (chainable). A `defineRoute` route-plugin also
   * folds its routes into `typeof app`, so the escape hatch never desyncs the
   * client's type; any other plugin behaves as in base h3.
   */
  register<P extends RoutePlugin>(
    plugin: P & NoRouteCollisions<Routes, InferRoutes<P>>,
  ): DuxServer<Prettify<MergePair<Routes, InferRoutes<P>>>, Bindings>
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
    opts: ServerOpts<Bindings, Route, 'get', V, P, Ret, Status, Err, Mw, Req>,
  ): DuxNext<Routes, Bindings, Route, 'get', V, P, Ret, Status, Err> {
    mount(this.native, 'get', route, opts as RuntimeOpts)
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
    opts: ServerOpts<Bindings, Route, 'post', V, P, Ret, Status, Err, Mw, Req>,
  ): DuxNext<Routes, Bindings, Route, 'post', V, P, Ret, Status, Err> {
    mount(this.native, 'post', route, opts as RuntimeOpts)
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
    opts: ServerOpts<Bindings, Route, 'put', V, P, Ret, Status, Err, Mw, Req>,
  ): DuxNext<Routes, Bindings, Route, 'put', V, P, Ret, Status, Err> {
    mount(this.native, 'put', route, opts as RuntimeOpts)
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
    opts: ServerOpts<Bindings, Route, 'patch', V, P, Ret, Status, Err, Mw, Req>,
  ): DuxNext<Routes, Bindings, Route, 'patch', V, P, Ret, Status, Err> {
    mount(this.native, 'patch', route, opts as RuntimeOpts)
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
    opts: ServerOpts<Bindings, Route, 'delete', V, P, Ret, Status, Err, Mw, Req>,
  ): DuxNext<Routes, Bindings, Route, 'delete', V, P, Ret, Status, Err> {
    mount(this.native, 'delete', route, opts as RuntimeOpts)
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
    opts: ServerOpts<Bindings, Route, 'head', V, P, Ret, Status, Err, Mw, Req>,
  ): DuxNext<Routes, Bindings, Route, 'head', V, P, Ret, Status, Err> {
    mount(this.native, 'head', route, opts as RuntimeOpts)
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
    opts: ServerOpts<Bindings, Route, 'options', V, P, Ret, Status, Err, Mw, Req>,
  ): DuxNext<Routes, Bindings, Route, 'options', V, P, Ret, Status, Err> {
    mount(this.native, 'options', route, opts as RuntimeOpts)
    return this as never
  }
}

/**
 * Create a typed h3 server. The counterpart of `createClient`: the server you
 * build here is the single source of truth the client is typed from
 * (`createClient<typeof app>()`). See docs/dux-conventions.md §5.
 */
export function createServer(config?: H3TypedConfig): DuxServer {
  return new DuxServer(config)
}
