import type {
  CreateTypedFetchOptions,
  NormalizeRoutes,
  TypedFetch,
} from 'h3-route-tools'
import type { ClientData, ClientError, HonestResult } from './internal/contract.ts'
import { createTypedFetch } from 'h3-route-tools'
import { DuxHTTPError } from './errors.ts'
import { DuxCall, parseEventStream } from './sse.ts'

// ── reconstructing the per-verb option/return shapes ──────────────────────────
// h3-route-tools doesn't export the internals of its typed fetch, so we rebuild
// the small pieces we need from the public `Endpoint`-shaped route map (the
// values of `NormalizeRoutes<App>[route][method]`). These mirror the upstream
// definitions exactly, minus the `method` key (the verb fixes it).

type Prettify<T> = { [K in keyof T]: T[K] }

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

/**
 * The call options for a verb+endpoint, resolved to **plain shapes**. Every slot
 * is extracted with an `infer` and the whole thing flattened with `Prettify`, so
 * neither the signature nor a diagnostic ever prints the underlying endpoint or
 * schema generics (`DuxEndpoint<…>`, `ObjectSchema<…>`) — only `{ body: { … } }`.
 * This is the client-side projection the contract kernel generalizes (delta 7).
 * When the route was interpolated the params already live in the path, so
 * `WithParams` is `false` and `params` is dropped.
 */
type VerbOptions<E, WithParams extends boolean> = Prettify<
  & (WithParams extends true ? ParamsOption<E extends { params: infer P } ? P : object> : object)
  & (E extends { body: infer B } ? BodyOption<B> : object)
  & { query?: E extends { query: infer Q } ? Q : never }
  & { headers?: E extends { headers: infer H } ? H : never }
>

/**
 * What a verb call returns: an `AsyncGenerator<T>` for an `sse()` endpoint (you
 * `for await` it), otherwise a {@link DuxCall} — `await` it for the honest
 * `{ data, error }`, `.orThrow()` for the value, `.raw()` for the native response.
 *
 * The success body is decoded by the endpoint's response *kind* via `ClientData`
 * (delta 10): `string` for `text()`, `Blob` for `binary()`, `undefined` for an
 * empty `204`, the serialized wire shape for `json`. The body and error map are
 * resolved by the projection *first*, so the return type never prints the
 * schema-typed `DuxEndpoint` — `{ [S in keyof Errors]: … }` forces the error map
 * to resolve to `{ 409: … }` rather than the lazy `EndpointErrors<…schema…>` alias.
 */
type VerbReturn<E> = E extends { kind: 'sse' }
  ? ClientData<E>
  : E extends { errors: infer Errors, kind: infer Kind extends import('./internal/contract.ts').ResponseKind }
    ? DuxCall<
      HonestResult<ClientData<E>, ClientError<{ [S in keyof Errors]: Errors[S] }>>,
      ClientData<E>,
      Kind
    >
    : DuxCall<HonestResult<unknown, ClientError<object>>, unknown, 'json'>

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

/** The route map behind a server: a dux `createServer` app, an upstream `H3Typed`, or a raw map. */
type RouteMapOf<App> = App extends { '~duxRoutes': infer R } ? Prettify<R> : NormalizeRoutes<App>

/**
 * The typed client: the bare `createTypedFetch` callable plus symmetric verb
 * methods. `api('/x', { method })` and `api.get('/x')` are the same call.
 */
export type Client<App, R = RouteMapOf<App>> = TypedFetch<R> & {
  get: VerbFetch<R, 'get'>
  post: VerbFetch<R, 'post'>
  put: VerbFetch<R, 'put'>
  patch: VerbFetch<R, 'patch'>
  delete: VerbFetch<R, 'delete'>
  head: VerbFetch<R, 'head'>
  options: VerbFetch<R, 'options'>
}

const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

/**
 * Build a typed fetch client from a server's `typeof app`. The counterpart of
 * `createServer`. Address routes with the bare `api(path, { method })` form or
 * the verb sugar `api.get(path, opts)` — both are typed end-to-end from the
 * server contract; see docs/dux-conventions.md §5.
 */
export function createClient<App>(options: CreateTypedFetchOptions = {}): Client<App> {
  const base = createTypedFetch(options)
  const call = base as (route: string, opts: Record<string, unknown>) => Promise<unknown>

  const verbs = Object.fromEntries(
    VERBS.map(method => [
      method,
      // A DuxCall handle: `await` runs the JSON fetch; `for await` runs the SSE
      // fetch (only one ever fires, chosen by how the caller consumes it).
      (route: string, opts: Record<string, unknown> = {}) => new DuxCall(
        () => call(route, { ...opts, method }) as Promise<Response>,
        async function* () {
          const headers = { accept: 'text/event-stream', ...(opts.headers as Record<string, string>) }
          const res = await call(route, { ...opts, method, headers }) as Response
          // A failed stream surfaces as a thrown DuxError, not a silent empty iterator.
          if (!res.ok)
            throw new DuxHTTPError(res.status, await res.json().catch(() => undefined), res)
          yield* parseEventStream(res)
        },
      ),
    ]),
  )

  // The dynamic verbs can't be statically proven against the precise generic —
  // the one boundary cast, mirroring upstream's `createTypedFetch`.
  return Object.assign(base, verbs) as unknown as Client<App>
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
