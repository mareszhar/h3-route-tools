import type {
  CreateTypedFetchOptions,
  NormalizeRoutes,
  TypedFetch,
  TypedResponse,
} from 'h3-route-tools'
import type { Serialize } from './internal/serialize.ts'
import type { EventStream } from './sse.ts'
import { createTypedFetch } from 'h3-route-tools'
import { DuxCall, parseEventStream } from './sse.ts'

// ── reconstructing the per-verb option/return shapes ──────────────────────────
// h3-route-tools doesn't export the internals of its typed fetch, so we rebuild
// the small pieces we need from the public `Endpoint`-shaped route map (the
// values of `NormalizeRoutes<App>[route][method]`). These mirror the upstream
// definitions exactly, minus the `method` key (the verb fixes it).

type Prettify<T> = { [K in keyof T]: T[K] }

/** Any key on `O` absent from `Expected` becomes `never` → an excess-property error. */
type NoExcess<O, Expected> = { [K in Exclude<keyof O, keyof Expected>]: never }

/** True when `T` has at least one required key (so the options argument is mandatory). */
type HasRequired<T> = Partial<T> extends T ? false : true

/** `params` is required when the route declares named params, optional otherwise. */
type ParamsOption<E> = E extends { params: infer P }
  ? [keyof P] extends [never]
      ? { params?: P }
      : string extends keyof P
        ? { params?: P }
        : { params: P }
  : object

type BodyOption<E> = E extends { body: infer B } ? (unknown extends B ? object : { body: B }) : object

interface QueryHeaderOption<E> {
  query?: E extends { query: infer Q } ? Q : never
  headers?: E extends { headers: infer H } ? H : never
}

/**
 * The call options for a verb+endpoint — upstream's `EndpointOptions` minus
 * `method`. When the route was interpolated the params already live in the path,
 * so `WithParams` is `false` and the `params` key is dropped.
 */
type VerbOptions<E, WithParams extends boolean> = Prettify<
  (WithParams extends true ? ParamsOption<E> : object) & BodyOption<E> & QueryHeaderOption<E>
>

/** The wire-shaped response, exactly as the base client reports it. */
type ResponseOf<E> = E extends { response: infer R } ? Serialize<R> : unknown

/**
 * What a verb call returns: an `AsyncGenerator<T>` for an `sse()` endpoint (you
 * `for await` it), otherwise a `Promise<TypedResponse>` (you `await` then `.json()`).
 */
type VerbReturn<E> = (E extends { response: infer R } ? R : unknown) extends EventStream<infer T>
  ? AsyncGenerator<T>
  : Promise<TypedResponse<ResponseOf<E>>>

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

/** The interpolated (template-literal) forms of those patterns — `` `/fruits/${id}` ``. */
type VerbTemplates<R, M extends string> = PathTemplate<VerbPatterns<R, M>>

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
type VerbArgs<E, WithParams extends boolean, O> = HasRequired<VerbOptions<E, WithParams>> extends true
  ? [options: O & NoExcess<O, VerbOptions<E, WithParams>>]
  : [options?: O & NoExcess<O, VerbOptions<E, WithParams>>]

/** Reject a literal pattern (it carries a `:param`) from the interpolation overload. */
type NotPattern<Route extends string> = Route extends `${string}:${string}` ? never : Route

// ── the verb methods ──────────────────────────────────────────────────────────

/**
 * One verb method (`api.get`, `api.post`, …). Two typed ways to address a route:
 *  1. literal pattern — `api.get('/fruits/:id', { params: { id } })`; the
 *     declared paths autocomplete and `params` is supplied here.
 *  2. interpolation — `` api.get(`/fruits/${id}`) ``; the params live in the path.
 *
 * The response is the wire shape; options are required only when the endpoint
 * needs them, so a bare `api.get('/health')` works.
 */
export interface VerbFetch<R, M extends string> {
  <const Route extends VerbPatterns<R, M>, const O extends VerbOptions<MatchEndpoint<R, M, Route>, true>>(
    route: Route,
    ...args: VerbArgs<MatchEndpoint<R, M, Route>, true, O>
  ): VerbReturn<MatchEndpoint<R, M, Route>>
  <const Route extends VerbTemplates<R, M>, const O extends VerbOptions<MatchEndpoint<R, M, Route>, false>>(
    route: NotPattern<Route>,
    ...args: VerbArgs<MatchEndpoint<R, M, Route>, false, O>
  ): VerbReturn<MatchEndpoint<R, M, Route>>
}

/** The route map behind a server: a dux `createServer` app, an upstream `H3Typed`, or a raw map. */
type RouteMapOf<App> = App extends { '~duxRoutes': infer R } ? R : NormalizeRoutes<App>

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
        () => call(route, { ...opts, method }),
        async function* () {
          const headers = { accept: 'text/event-stream', ...(opts.headers as Record<string, string>) }
          const res = await call(route, { ...opts, method, headers }) as Response
          yield* parseEventStream(res)
        },
      ),
    ]),
  )

  // The dynamic verbs can't be statically proven against the precise generic —
  // the one boundary cast, mirroring upstream's `createTypedFetch`.
  return Object.assign(base, verbs) as unknown as Client<App>
}
