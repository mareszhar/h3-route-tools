import type { H3DuxTransportError } from './errors.ts'
import type { ClientData, ClientErrors, ClientHttpError, ResponseKind, SuccessKindOf } from './internal/contract.ts'
import type {
  CreateTypedFetchOptions,
  FetchLike,
  NormalizeRoutes,
  TypedResponse,
} from './typed-fetch.ts'
import { H3DuxHTTPError } from './errors.ts'
import { H3DuxCall, parseEventStream } from './sse.ts'

// ── reconstructing the per-verb option/return shapes ──────────────────────────
// The verb client reads the public endpoint contract map directly. Each verb
// fixes the method, so the options shape stays plain and native diagnostics do
// the useful work at the cursor.

type Prettify<T> = { [K in keyof T]: T[K] }

export type QuerySerializer = 'repeat' | ((params: Record<string, unknown>) => string | URLSearchParams)

export type RetryOptions = number | false | {
  attempts?: number
  statuses?: readonly number[]
  methods?: readonly string[]
}

export interface H3DuxRequestHookContext {
  route: string
  method: string
  url: string
  request: Request
  attempt: number
}

export interface H3DuxResponseHookContext extends H3DuxRequestHookContext {
  response: Response
}

export interface H3DuxRequestErrorHookContext extends H3DuxRequestHookContext {
  error: unknown
}

export interface H3DuxClientTransportOptions {
  signal?: AbortSignal
  timeout?: number
  retry?: RetryOptions
  querySerializer?: QuerySerializer
  onRequest?: (ctx: H3DuxRequestHookContext) => void | Promise<void>
  onResponse?: (ctx: H3DuxResponseHookContext) => void | Promise<void>
  onRequestError?: (ctx: H3DuxRequestErrorHookContext) => void | Promise<void>
  onResponseError?: (ctx: H3DuxResponseHookContext) => void | Promise<void>
}

export interface CreateClientOptions extends CreateTypedFetchOptions, H3DuxClientTransportOptions {}

type TransportCallOptions = Pick<H3DuxClientTransportOptions, 'signal' | 'timeout' | 'retry' | 'querySerializer'>

/** True when `T` has at least one required key (so the options argument is mandatory). */
type HasRequired<T> = Partial<T> extends T ? false : true

/** `params` is required when the route declares named params, optional otherwise. */
type ParamsOption<P> = [keyof P] extends [never]
  ? { params?: P }
  : string extends keyof P
    ? { params?: P }
    : { params: P }

/** Present only when the endpoint declares a body. */
type BodyOption<B> = unknown extends B ? object : { body: B }

/** The kernel's `request` block — the caller-supplied shapes for one endpoint. */
type RequestOf<E> = E extends { request: infer Req } ? Req : object

/**
 * The call options for a verb+endpoint, resolved to **plain shapes** from the
 * kernel's `request`. Every slot is extracted with an `infer` and flattened with
 * `Prettify`, so neither the signature nor a diagnostic ever prints the underlying
 * kernel or schema generics (`H3DuxEndpoint<…>`, `ObjectSchema<…>`) — only
 * `{ body: { … } }`. When the route was interpolated the params already live in the
 * path, so `WithParams` is `false` and `params` is dropped.
 */
type VerbOptions<E, WithParams extends boolean, Req = RequestOf<E>> = Prettify<
  & (WithParams extends true ? ParamsOption<Req extends { params: infer P } ? P : object> : object)
  & (Req extends { body: infer B } ? BodyOption<B> : object)
  & { query?: Req extends { query: infer Q } ? Q : never }
  & { headers?: Req extends { headers: infer H } ? H : never }
  & TransportCallOptions
>

/**
 * What a verb call returns: an `AsyncGenerator<T>` for an `sse()` endpoint (you
 * `for await` it), otherwise a {@link H3DuxCall} — `await` it for the honest
 * `{ data, error }`, `.orThrow()` for the value, `.raw()` for the native response.
 *
 * The success body is decoded by the endpoint's response *kind* via `ClientData`
 * (delta 10): `string` for `text()`, `Blob` for `binary()`, `undefined` for an
 * empty `204`, the serialized wire shape for `json`. The honest result is **inlined**
 * here, not wrapped in a named alias, and every piece (`ClientData`, `ClientHttpError`,
 * `ClientErrors`) is a *conditional* that resolves first — so the awaited value hovers
 * as `{ data: Fruit; error: undefined } | { data: undefined; error: H3DuxHTTPError<…>
 * | H3DuxTransportError }`, plain shapes and documented classes, never an alias wrapper.
 */
type VerbReturn<E> = [E] extends [never]
  ? H3DuxCall<
    { data: unknown, error: undefined } | { data: undefined, error: ClientHttpError<object> | H3DuxTransportError },
    unknown,
    'json'
  >
  : SuccessKindOf<E> extends 'sse'
    ? ClientData<E>
    : H3DuxCall<
      | { data: ClientData<E>, error: undefined }
      | { data: undefined, error: ClientHttpError<ClientErrors<E>> | H3DuxTransportError },
      ClientData<E>,
      SuccessKindOf<E> extends ResponseKind ? SuccessKindOf<E> : 'json'
    >

/** Replace each `:param` segment of a route pattern with a `${string}` hole. */
type PathTemplate<P extends string> = P extends `${infer Head}:${infer After}`
  ? After extends `${infer _Param}/${infer Rest}`
    ? `${Head}${string}/${PathTemplate<Rest>}`
    : `${Head}${string}`
  : P

/** Literal route patterns in `R` that declare verb `M`. */
type VerbPatterns<R, M extends string> = {
  [Route in keyof R & string]: M extends keyof R[Route] ? Route : never;
}[keyof R & string]

/** Of those, only the ones carrying a `:param` — the routes interpolation applies to. */
type ParamPatterns<R, M extends string> = {
  [P in VerbPatterns<R, M>]: P extends `${string}:${string}` ? P : never;
}[VerbPatterns<R, M>]

/** The interpolated (template-literal) forms of the param routes — `` `/fruits/${id}` ``. */
type VerbTemplates<R, M extends string> = PathTemplate<ParamPatterns<R, M>>

/** Every route argument a verb accepts: the literal patterns plus the interpolated param forms. */
type VerbRoutes<R, M extends string> = VerbPatterns<R, M> | VerbTemplates<R, M>

/**
 * The literal patterns, forced to *evaluate* to their string literals (the
 * `extends infer U`). Used for two things the template forms would spoil:
 *  - completions — a `${string}` template in the union subsumes `/fruits/:id`,
 *    so it would vanish from the dropdown; the patterns alone keep it.
 *  - the bad-route message — a typo reports against `'/fruits' | '/fruits/:id'`,
 *    not the whole accumulated route map printed as a lazy generic.
 */
type CleanPatterns<R, M extends string> = VerbPatterns<R, M> extends infer U ? U & string : never

/** True when the route argument is a declared literal pattern (so `params` are supplied at the call). */
type IsPattern<R, M extends string, Route extends string> = Route extends VerbPatterns<R, M> ? true : false

/** Does interpolated `Input` match route `Pattern`, treating each `:x` as exactly one segment? */
type Matches<Input extends string, Pattern extends string> = Pattern extends `${infer PH}/${infer PR}`
  ? Input extends `${infer IH}/${infer IR}`
    ? PH extends `:${string}`
      ? Matches<IR, PR>
      : PH extends IH ? Matches<IR, PR> : false
    : false
  : Pattern extends `:${string}`
    ? Input extends `${string}/${string}` ? false : (Input extends '' ? false : true)
    : Input extends Pattern ? true : false

/** Resolve a call's route argument (literal pattern or interpolated path) to its pattern. */
type MatchPattern<R, M extends string, Route extends string> = Route extends VerbPatterns<R, M>
  ? Route
  : { [P in VerbPatterns<R, M>]: Matches<Route, P> extends true ? P : never }[VerbPatterns<R, M>]

/** The endpoint behind the resolved pattern. */
type MatchEndpoint<R, M extends string, Route extends string>
  = MatchPattern<R, M, Route> extends infer P extends keyof R ? R[P][M & keyof R[P]] : never

/** The options argument(s) for a verb call — required only when the endpoint needs them. */
type VerbArgs<E, WithParams extends boolean> = HasRequired<VerbOptions<E, WithParams>> extends true
  ? [options: VerbOptions<E, WithParams>]
  : [options?: VerbOptions<E, WithParams>]

// ── the verb methods ──────────────────────────────────────────────────────────

/**
 * One verb method (`api.get`, `api.post`, …). A single call signature covers two
 * ways to address a route — both typed end-to-end from the server contract:
 *  1. literal pattern — `api.get('/fruits/:id', { params: { id } })`; the
 *     declared paths autocomplete and `params` is supplied here.
 *  2. interpolation — `` api.get(`/fruits/${id}`) ``; the params live in the path.
 *
 * One signature (not an overload pair) is deliberate: TypeScript reports a bad
 * call against *this* shape directly, instead of the doubled, unreadable
 * "No overload matches this call" wall (see docs/dux-spec.md delta 6). The
 * response is the wire shape; options are required only when the endpoint needs
 * them, so a bare `api.get('/health')` works.
 *
 * The route parameter is `Route extends VerbRoutes ? Route : CleanPatterns`: a
 * valid literal **or** interpolated path is accepted as itself, while anything
 * else (a typo, or the empty string mid-type) falls back to the literal patterns
 * — which is exactly what completions should offer and what a bad route should
 * report against. This keeps the interpolation forms out of the *completion*
 * type (so `/fruits/:id` survives the dropdown) without a second overload.
 */
export interface VerbFetch<R, M extends string> {
  <const Route extends string>(
    route: Route extends VerbRoutes<R, M> ? Route : CleanPatterns<R, M>,
    ...args: VerbArgs<MatchEndpoint<R, M, Route>, IsPattern<R, M, Route>>
  ): VerbReturn<MatchEndpoint<R, M, Route>>
}

// ── the bare call (`api(path, { method })`) — the low-level primitive, kept ────
// The verb sugar fixes the method; the bare form names it in the options. It reads
// the same kernel as the verbs and keeps the baseline `TypedResponse` (double-await)
// shape, so `(await api('/x', { method })).json()` stays valid.

/** A route's declared (lowercase) methods plus their uppercase spellings — both accepted. */
type BareMethodInput<Methods> = (keyof Methods & string) | Uppercase<keyof Methods & string>

/** The endpoint for a bare call's `method`, looked up by its lowercase key. */
type BareEndpoint<R, Route extends keyof R, M> = R[Route][Lowercase<M & string> & keyof R[Route]]

/** Any key on `O` absent from the expected options becomes `never` → an excess-property error. */
type NoExcess<O, Expected> = { [K in Exclude<keyof O, keyof Expected>]: never }

/**
 * The bare typed fetch: `api(route, { method, params?, query?, body?, headers? })`.
 * `O &` anchors `method` inference (so the response narrows to the chosen method),
 * `NoExcess` flags stray keys, and the result is a `TypedResponse<Data>` whose
 * `.json()` is the kind-decoded success body.
 */
export interface BareFetch<R> {
  <Route extends keyof R & string, const O extends { method: BareMethodInput<R[Route]> }>(
    route: Route,
    options: O
      & { method: BareMethodInput<R[Route]> }
      & VerbOptions<BareEndpoint<R, Route, O['method']>, true>
      & NoExcess<O, { method: unknown } & VerbOptions<BareEndpoint<R, Route, O['method']>, true>>,
  ): Promise<TypedResponse<ClientData<BareEndpoint<R, Route, O['method']>>>>
}

/** The route map behind a server, a native h3-dux accumulator, or a raw map. */
type RouteMapOf<App> = App extends { '~duxRoutes': infer R } ? Prettify<R> : NormalizeRoutes<App>

/**
 * The typed client: the bare callable plus symmetric verb methods. `api('/x', {
 * method })` and `api.get('/x')` are the same call, both typed from the kernel.
 */
export type Client<App, R = RouteMapOf<App>> = BareFetch<R> & {
  get: VerbFetch<R, 'get'>
  post: VerbFetch<R, 'post'>
  put: VerbFetch<R, 'put'>
  patch: VerbFetch<R, 'patch'>
  delete: VerbFetch<R, 'delete'>
  head: VerbFetch<R, 'head'>
  options: VerbFetch<R, 'options'>
}

const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

interface RuntimeOptions extends H3DuxClientTransportOptions {
  method: string
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
  headers?: Record<string, string>
}

interface ResolvedRetry {
  attempts: number
  statuses: readonly number[]
  methods?: readonly string[]
  explicit: boolean
}

const DEFAULT_RETRY_STATUSES = [408, 429, 500, 502, 503, 504] as const
const DEFAULT_RETRY_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const

function serializeQuery(query: Record<string, unknown>, serializer: QuerySerializer | undefined): string {
  if (typeof serializer === 'function')
    return String(serializer(query))
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null)
      continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null)
          search.append(key, String(item))
      }
      continue
    }
    search.set(key, String(value))
  }
  return search.toString()
}

function applyParams(route: string, params: Record<string, unknown> | undefined): string {
  let path = route
  if (!params)
    return path
  for (const [key, value] of Object.entries(params)) {
    const encoded = encodeURIComponent(String(value))
    path = path.replace(`**:${key}`, encoded).replace(`:${key}`, encoded)
  }
  return path
}

function requestURL(url: string): string {
  try {
    return new URL(url).toString()
  }
  catch {
    return new URL(url, 'http://h3-dux.local').toString()
  }
}

function timeoutSignal(userSignal: AbortSignal | undefined, timeout: number | undefined): { signal?: AbortSignal, cleanup: () => void } {
  if (timeout === undefined)
    return { signal: userSignal, cleanup: () => {} }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const abort = () => controller.abort(userSignal?.reason)
  if (userSignal?.aborted) {
    abort()
  }
  else {
    userSignal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeout)
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer)
        clearTimeout(timer)
      userSignal?.removeEventListener('abort', abort)
    },
  }
}

function retryOptions(globalRetry: RetryOptions | undefined, callRetry: RetryOptions | undefined): ResolvedRetry {
  const source = callRetry ?? globalRetry
  if (!source)
    return { attempts: 0, statuses: DEFAULT_RETRY_STATUSES, explicit: callRetry !== undefined }
  if (typeof source === 'number')
    return { attempts: Math.max(0, source), statuses: DEFAULT_RETRY_STATUSES, explicit: callRetry !== undefined }
  return {
    attempts: Math.max(0, source.attempts ?? 0),
    statuses: source.statuses ?? DEFAULT_RETRY_STATUSES,
    methods: source.methods?.map(method => method.toUpperCase()),
    explicit: callRetry !== undefined || !!source.methods,
  }
}

function retryableMethod(method: string, retry: ResolvedRetry): boolean {
  if (retry.methods)
    return retry.methods.includes(method)
  if (DEFAULT_RETRY_METHODS.includes(method as typeof DEFAULT_RETRY_METHODS[number]))
    return true
  return retry.explicit
}

function retryDelay(response: Response): number {
  const value = response.headers.get('retry-after')
  if (!value)
    return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds))
    return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
}

function createDuxFetch(options: CreateClientOptions): (route: string, opts: RuntimeOptions) => Promise<Response> {
  const {
    baseURL = '',
    fetch: transport = globalThis.fetch as FetchLike,
    headers: baseHeaders,
  } = options

  return async (route, opts) => {
    const method = opts.method.toUpperCase()
    let url = baseURL + applyParams(route, opts.params)
    if (opts.query) {
      const qs = serializeQuery(opts.query, opts.querySerializer ?? options.querySerializer)
      if (qs)
        url += (url.includes('?') ? '&' : '?') + qs
    }

    const headers = new Headers(baseHeaders)
    if (opts.headers) {
      for (const [key, value] of Object.entries(opts.headers))
        headers.set(key, value)
    }
    let body: BodyInit | undefined
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body)
      if (!headers.has('content-type'))
        headers.set('content-type', 'application/json')
    }

    const retry = retryOptions(options.retry, opts.retry)
    const canRetry = retry.attempts > 0 && retryableMethod(method, retry)
    const maxAttempts = canRetry ? retry.attempts + 1 : 1
    let lastError: unknown

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { signal, cleanup } = timeoutSignal(opts.signal ?? options.signal, opts.timeout ?? options.timeout)
      const init: RequestInit = { method, headers: new Headers(headers), body, signal }
      const request = new Request(requestURL(url), init)
      const ctx: H3DuxRequestHookContext = { route, method, url, request, attempt }
      try {
        await options.onRequest?.(ctx)
        const res = await transport(url, {
          method,
          headers: request.headers,
          body,
          signal,
        })
        const responseCtx: H3DuxResponseHookContext = { ...ctx, response: res }
        await options.onResponse?.(responseCtx)
        if (!res.ok)
          await options.onResponseError?.(responseCtx)
        if (!res.ok && attempt < maxAttempts && retry.statuses.includes(res.status)) {
          await sleep(retryDelay(res))
          continue
        }
        return res
      }
      catch (error) {
        lastError = error
        await options.onRequestError?.({ ...ctx, error })
        if (attempt >= maxAttempts)
          throw error
      }
      finally {
        cleanup()
      }
    }
    throw lastError
  }
}

/**
 * Build a typed fetch client from a server's `typeof app`. The counterpart of
 * `createServer`. Address routes with the bare `api(path, { method })` form or
 * the verb sugar `api.get(path, opts)` — both are typed end-to-end from the
 * server contract; see docs/dux-patterns.md §2.
 */
export function createClient<App>(options: CreateClientOptions = {}): Client<App> {
  const call = createDuxFetch(options) as (route: string, opts: RuntimeOptions) => Promise<Response>

  const verbs = Object.fromEntries(
    VERBS.map(method => [
      method,
      // A H3DuxCall handle: `await` runs the JSON fetch; `for await` runs the SSE
      // fetch (only one ever fires, chosen by how the caller consumes it).
      (route: string, opts: Record<string, unknown> = {}) => new H3DuxCall(
        () => call(route, { ...opts, method } as RuntimeOptions),
        async function* () {
          const headers = { accept: 'text/event-stream', ...(opts.headers as Record<string, string>) }
          const res = await call(route, { ...opts, method, headers } as RuntimeOptions)
          // A failed stream surfaces as a thrown H3DuxError, not a silent empty iterator.
          if (!res.ok)
            throw new H3DuxHTTPError(res.status, await res.json().catch(() => undefined), res)
          yield* parseEventStream(res)
        },
      ),
    ]),
  )

  // The dynamic verbs can't be statically proven against the precise generic —
  // The dynamic verbs can't be statically proven against the precise generic.
  return Object.assign(call, verbs) as unknown as Client<App>
}

/**
 * A client wired to an in-process app via `app.request` — for tests, SSR, and
 * server-to-server calls. Named so the in-process transport is a deliberate
 * choice, never copy-pasted into a browser bundle (use `baseURL` there).
 */
export function createTestClient<App>(
  app: { request: (input: string, init?: RequestInit) => Response | Promise<Response> },
): Client<App> {
  return createClient<App>({ fetch: app.request })
}
