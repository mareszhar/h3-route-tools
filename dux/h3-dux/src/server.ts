import type { H3Event, H3RouteMeta, Middleware } from 'h3'
import type {
  H3TypedConfig,
  MethodValidate,
  OnValidationError,
  RouteMethod,
  SchemaWithJSON,
  ValidateSource,
} from 'h3-route-tools'
import type {
  AnyMethodValidate,
  DuxRouteRecord,
  DuxVerbOpts,
  InferMethodResponse,
  MergePair,
  Prettify,
} from './internal/route-types.ts'
import { createEventStream, getQuery, HTTPError } from 'h3'
import { H3Typed } from 'h3-route-tools'
import { isEventStream } from './sse.ts'

/** The server type after adding one route+method — accumulates into `typeof app`. */
type DuxNext<
  Routes,
  Route extends string,
  M extends RouteMethod,
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
> = DuxServer<Prettify<MergePair<Routes, DuxRouteRecord<Route, M, V, P, Ret>>>>

/** Loose runtime view of a verb's options, for the dispatch boundary. */
interface RuntimeOpts {
  params?: SchemaWithJSON
  middleware?: Middleware[]
  meta?: H3RouteMeta
  status?: number
  onValidationError?: OnValidationError
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
  // The response schema upstream value-validates (none, when we stream it ourselves).
  const response = sseSchema ? undefined : validate?.response
  const upstreamValidate = eager
    ? { query: schemas.query, body: schemas.body, headers: schemas.headers, response }
    : (response ? { response } : undefined)

  const wrapped = async (event: H3Event): Promise<unknown> => {
    if (status !== undefined)
      event.res.status = status
    attachValid(event, eager, schemas, onValidationError)
    if (eager) {
      const ctx = event.context as Record<string, unknown>
      const validated = (event as { validated?: Record<string, unknown> }).validated
      ctx.query = validated?.query ?? getQuery(event)
      if (schemas.body)
        ctx.body = await event.req.json()
    }
    const result = await handler(event)
    if (sseSchema)
      return streamSse(event, result as AsyncIterable<unknown>, sseSchema, onValidationError)
    return result
  }

  ;(app.route as RouteCall)({
    route,
    params,
    middleware,
    meta,
    [method]: { validate: upstreamValidate, handler: wrapped, onValidationError },
  })
}

/**
 * The dux server: a typed route builder around upstream's `H3Typed`. Author with
 * per-verb methods (`app.get(path, opts)`) that read symmetrically with the
 * client and infer the response from the handler when no `validate.response` is
 * declared. The accumulated `typeof app` is the single source of truth a
 * `createClient<typeof app>()` reads.
 *
 * It is a thin wrapper (not an `H3` subclass) so the verb names never collide
 * with h3's own `app.get(path, handler)` routing. The underlying app is exposed
 * as `.app` for native h3 (`.on`, `.route`, plugins) when you need it.
 */
export class DuxServer<Routes = object> {
  /** Type-only marker carrying the accumulated route map; read by `createClient`. */
  declare readonly '~duxRoutes': Routes

  /** The underlying h3 app — the escape hatch for native h3 and `.route(...)`. */
  readonly app: H3Typed

  /** Web-standard fetch handler — `serve(app)` or `serve({ fetch: app.fetch })`. */
  readonly fetch: (request: Request) => Response | Promise<Response>

  /** In-process request, for a typed client hitting the app directly. */
  readonly request: (input: string, init?: RequestInit) => Response | Promise<Response>

  constructor(config?: H3TypedConfig) {
    this.app = new H3Typed(config)
    this.fetch = request => this.app.fetch(request)
    this.request = (input, init) => this.app.request(input, init)
  }

  /** Register h3 middleware (chainable) — this is how auth attaches. */
  use(...args: Parameters<H3Typed['use']>): this {
    this.app.use(...args)
    return this
  }

  get<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
  >(route: Route,
    opts: DuxVerbOpts<V, P, 'get', Ret, Route>,
  ): DuxNext<Routes, Route, 'get', V, P, Ret> {
    mount(this.app, 'get', route, opts as RuntimeOpts)
    return this as unknown as DuxNext<Routes, Route, 'get', V, P, Ret>
  }

  post<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
  >(route: Route,
    opts: DuxVerbOpts<V, P, 'post', Ret, Route>,
  ): DuxNext<Routes, Route, 'post', V, P, Ret> {
    mount(this.app, 'post', route, opts as RuntimeOpts)
    return this as unknown as DuxNext<Routes, Route, 'post', V, P, Ret>
  }

  put<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
  >(route: Route,
    opts: DuxVerbOpts<V, P, 'put', Ret, Route>,
  ): DuxNext<Routes, Route, 'put', V, P, Ret> {
    mount(this.app, 'put', route, opts as RuntimeOpts)
    return this as unknown as DuxNext<Routes, Route, 'put', V, P, Ret>
  }

  patch<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
  >(route: Route,
    opts: DuxVerbOpts<V, P, 'patch', Ret, Route>,
  ): DuxNext<Routes, Route, 'patch', V, P, Ret> {
    mount(this.app, 'patch', route, opts as RuntimeOpts)
    return this as unknown as DuxNext<Routes, Route, 'patch', V, P, Ret>
  }

  delete<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
  >(route: Route,
    opts: DuxVerbOpts<V, P, 'delete', Ret, Route>,
  ): DuxNext<Routes, Route, 'delete', V, P, Ret> {
    mount(this.app, 'delete', route, opts as RuntimeOpts)
    return this as unknown as DuxNext<Routes, Route, 'delete', V, P, Ret>
  }

  head<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
  >(route: Route,
    opts: DuxVerbOpts<V, P, 'head', Ret, Route>,
  ): DuxNext<Routes, Route, 'head', V, P, Ret> {
    mount(this.app, 'head', route, opts as RuntimeOpts)
    return this as unknown as DuxNext<Routes, Route, 'head', V, P, Ret>
  }

  options<
    const Route extends string,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
  >(route: Route,
    opts: DuxVerbOpts<V, P, 'options', Ret, Route>,
  ): DuxNext<Routes, Route, 'options', V, P, Ret> {
    mount(this.app, 'options', route, opts as RuntimeOpts)
    return this as unknown as DuxNext<Routes, Route, 'options', V, P, Ret>
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
