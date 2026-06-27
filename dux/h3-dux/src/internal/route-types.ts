/**
 * The per-method type machinery for the dux server builder.
 *
 * Owned route type machinery, adapted from the reference implementation and
 * shaped around the h3-dux contract kernel. These types are local because
 * h3-dux owns the handler event model and the client projection.
 *
 * Two dux additions:
 *  - response *inference*: a method with no `validate.response` contributes the
 *    handler's return type to the contract (Hono/Elysia parity), not `unknown`.
 *  - param *inference*: `:params` are read from the route pattern, so a simple
 *    `/fruits/:id` types `event.context.params.id` as `string` without a schema.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { EventHandlerRequest, H3Event, H3RouteMeta, HTTPError, Middleware } from 'h3'
import type {
  MiddlewareTupleIssue,
  RequirementsIssue,
  TupleBindings,
} from '../middleware.ts'
import type {
  BinaryBody,
  BinaryResponse,
  ResponseKindOf,
  TextResponse,
  TypedNativeResponse,
} from '../response.ts'
import type { BodylessMethod, MethodValidate } from '../route.ts'
import type { EventStream } from '../sse.ts'
import type { H3DuxOpenAPI } from './openapi-types.ts'
import type {
  InferInput,
  InferOutput,
  OnValidationError,
  RouteMethod,
  SchemaWithJSON,
  StatusCodeKey,
} from './schema-types.ts'

/** Flatten an intersection into a plain object type (display only). */
export type Prettify<T> = { [K in keyof T]: T[K] }

/** The declared response schema of a method (possibly `sse()`-branded), or `undefined`. */
type ResponseSchema<V extends AnyMethodValidate> = V extends { response?: infer R } ? R : undefined

export type AnyMethodValidate = MethodValidate<any, any, any, any>

// ── inference helpers ─────────────────────────────────────────────────────────

type Direction = 'input' | 'output'
type InferDir<S extends SchemaWithJSON, D extends Direction> = D extends 'input'
  ? InferInput<S>
  : InferOutput<S>

type InferMethodBodyDir<V extends AnyMethodValidate, D extends Direction> = V extends { body?: infer B }
  ? [B] extends [SchemaWithJSON]
      ? InferDir<B, D>
      : B extends Record<string, SchemaWithJSON>
        ? { [K in keyof B]: InferDir<B[K], D> }[keyof B]
        : unknown
  : unknown
type InferMethodBody<V extends AnyMethodValidate> = InferMethodBodyDir<V, 'output'>

type InferMethodQueryDir<V extends AnyMethodValidate, D extends Direction> = V extends { query?: infer Q }
  ? [Q] extends [SchemaWithJSON] ? InferDir<Q, D> : Partial<Record<string, string>>
  : Partial<Record<string, string>>
type InferMethodQuery<V extends AnyMethodValidate> = InferMethodQueryDir<V, 'output'>

type InferMethodHeadersDir<V extends AnyMethodValidate, D extends Direction> = V extends { headers?: infer H }
  ? [H] extends [SchemaWithJSON] ? InferDir<H, D> : Record<string, string>
  : Record<string, string>
type InferMethodHeaders<V extends AnyMethodValidate> = InferMethodHeadersDir<V, 'output'>

export type InferMethodResponse<V extends AnyMethodValidate> = V extends { response?: infer R }
  ? [R] extends [SchemaWithJSON]
      ? InferOutput<R>
      : R extends Record<StatusCodeKey, SchemaWithJSON>
        ? { [K in keyof R]: InferOutput<R[K]> }[keyof R]
        : unknown
  : unknown

// ── response split: success (data) vs errors (per status) — delta 7/9 ─────────

/** The errors option: a status → schema map declaring an endpoint's typed failures. */
export type ErrorsOption = Partial<Record<StatusCodeKey, SchemaWithJSON>>

/** The auto-registered body of a request-validation failure (`422`). */
export interface ValidationErrorBody {
  source: string
  issues: ReadonlyArray<StandardSchemaV1.Issue>
}

/** Is a status key (number or numeric string) in the 2xx range? */
type Is2xx<S> = `${S & (string | number)}` extends `2${string}` ? true : false

/** Normalise a status key to a number, so the error map is keyed numerically for the client. */
type NumKey<S> = S extends number ? S : S extends `${infer N extends number}` ? N : never

/** The success (2xx) body a method answers with — bare schema, the 2xx of a status map, else inferred. */
export type SuccessResponse<
  V extends AnyMethodValidate,
  Ret,
  M extends RouteMethod,
  Status extends number | undefined,
> = IsEmptyResponse<M, Status> extends true
  ? undefined
  : ResponseSchema<V> extends EventStream<infer T>
    ? EventStream<T>
    : ResponseSchema<V> extends TextResponse
      ? string
      : ResponseSchema<V> extends BinaryResponse
        ? Blob
        : [ResponseSchema<V>] extends [SchemaWithJSON]
            ? InferOutput<ResponseSchema<V>>
            : ResponseSchema<V> extends Record<StatusCodeKey, SchemaWithJSON>
              ? Pick2xx<ResponseSchema<V>>
              : Ret extends TypedNativeResponse<infer Data, infer _Kind>
                ? Data
                : unknown extends InferMethodResponse<V> ? Ret : InferMethodResponse<V>

/**
 * The response *kind* an endpoint answers with (delta 10) — the kernel tag every
 * plane reads. `sse()`/`text()`/`binary()` declare it explicitly; otherwise it is
 * inferred from the schema/return: strings are text, bytes are binary, empty
 * values/statuses are empty, and everything else is JSON. A plain native
 * `Response` stays opaque; `typedResponse()` carries an explicit body contract.
 * See docs/dux-patterns.md §8.
 */
export type SuccessKind<
  V extends AnyMethodValidate,
  Ret,
  M extends RouteMethod,
  Status extends number | undefined,
> = IsEmptyResponse<M, Status> extends true
  ? 'empty'
  : ResponseSchema<V> extends EventStream<infer _T>
    ? 'sse'
    : ResponseSchema<V> extends TextResponse
      ? 'text'
      : ResponseSchema<V> extends BinaryResponse
        ? 'binary'
        : [ResponseSchema<V>] extends [SchemaWithJSON]
            ? ResponseKindOf<InferOutput<ResponseSchema<V>>>
            : ResponseSchema<V> extends Record<StatusCodeKey, SchemaWithJSON>
              ? ResponseKindOf<Pick2xx<ResponseSchema<V>>>
              : Ret extends TypedNativeResponse<infer _Data, infer Kind>
                ? Kind
                : [Ret] extends [Response]
                    ? 'json'
                    : ResponseKindOf<Awaited<Ret>>

/** Status/method combinations whose wire response cannot carry a body. */
type IsEmptyResponse<M extends RouteMethod, Status extends number | undefined>
  = M extends 'head' ? true : Status extends 204 | 205 ? true : false

/** Union of the 2xx entry outputs of a response status map. */
type Pick2xx<M> = {
  [S in keyof M as Is2xx<S> extends true ? S : never]: M[S] extends SchemaWithJSON ? InferOutput<M[S]> : never
} extends infer O ? O[keyof O] : never

/** Non-2xx entries of a response status map → `{ status: body }`. */
type ResponseErrorMap<V extends AnyMethodValidate> = ResponseSchema<V> extends Record<StatusCodeKey, SchemaWithJSON>
  ? { [S in keyof ResponseSchema<V> as Is2xx<S> extends true ? never : NumKey<S>]: ResponseSchema<V>[S] extends SchemaWithJSON ? InferOutput<ResponseSchema<V>[S]> : never }
  : object

/** The declared `errors` map → `{ status: body }`. */
type DeclaredErrorMap<Err> = [Err] extends [ErrorsOption]
  ? { [S in keyof Err as NumKey<S>]: Err[S] extends SchemaWithJSON ? InferOutput<Err[S]> : never }
  : object

/** True when the endpoint validates any request scope (so a `422` can occur). */
type HasRequestValidation<V extends AnyMethodValidate, P extends SchemaWithJSON | undefined>
  = [(P extends SchemaWithJSON ? 'params' : never) | HasSchema<V, 'query'> | HasSchema<V, 'body'> | HasSchema<V, 'headers'>] extends [never]
    ? false
    : true

/** The endpoint's full error map: response non-2xx ∪ declared `errors` ∪ the auto `422` envelope. */
export type EndpointErrors<V extends AnyMethodValidate, P extends SchemaWithJSON | undefined, Err>
  = ResponseErrorMap<V> & DeclaredErrorMap<Err> & (HasRequestValidation<V, P> extends true ? { 422: ValidationErrorBody } : object)

/** `event.error(status, data)` — a typed thrower, checked against the declared error schema for `status`. */
export type ErrorFn<Err> = [Err] extends [ErrorsOption]
  ? <S extends keyof Err>(status: S, data: Err[S] extends SchemaWithJSON ? InferInput<Err[S]> : never) => HTTPError
  : (status: StatusCodeKey, data?: unknown) => HTTPError

// ── param inference (dux) ─────────────────────────────────────────────────────

/** Read `:param` names from a route pattern into `{ name: string }`. */
type RouteParams<Route extends string> = Route extends `${string}:${infer Param}/${infer Rest}`
  ? Record<Param, string> & RouteParams<`/${Rest}`>
  : Route extends `${string}:${infer Param}`
    ? Record<Param, string>
    : Record<string, string>

/** Read only the literal `:param` names from a path pattern. */
export type PathParamNames<Route extends string> = Route extends `${string}:${infer Param}/${infer Rest}`
  ? Param | PathParamNames<`/${Rest}`>
  : Route extends `${string}:${infer Param}`
    ? Param
    : never

/** The params a handler sees: the schema's output if declared, else inferred from the pattern. */
type ResolvedParams<P extends SchemaWithJSON | undefined, Route extends string>
  = P extends SchemaWithJSON ? InferOutput<P> : RouteParams<Route>

// ── path composition (routers — delta 11) ─────────────────────────────────────

/** Join a router prefix and a local route into the full pattern the client addresses. */
export type JoinPath<Prefix extends string, Local extends string>
  = Local extends '/' ? (Prefix extends '' ? '/' : Prefix) : `${Prefix}${Local}`

// ── the public, route-agnostic handler event (for userland utilities) ─────────

/**
 * The h3-dux handler event, route-agnostic — annotate a **utility** with this to
 * accept any handler's `event`, the way plain-h3 utils take `H3Event`. No interface
 * to hand-roll: `function requireKey(e: H3DuxEvent) { … e.error(401, body) }` just
 * works, and every per-route handler event is assignable to it.
 *
 * It is the public base over `H3Event`: the full native surface plus the dux
 * additions at their loosest honest types — the `event.error(status, data)` thrower
 * (route-agnostic here; narrowed to the *declared* statuses inside a handler, where
 * the contract is known), the request aliases (`params`/`query`/`body`), and
 * `event.bindings`. Parameterize `Bindings` when a util depends on a middleware
 * capability: `function requireOwner(e: H3DuxEvent<{ user: User }>)`.
 *
 * `error` is a method (not an arrow property) on purpose: the bivariant parameter
 * check is what lets a handler's status-narrowed `error` stay assignable here.
 */
export interface H3DuxEvent<Bindings = unknown> extends Omit<H3Event, 'context'> {
  /** Throw a declared error: `throw e.error(status, data)` (delta 9). */
  // Method syntax is deliberate here: its *bivariant* parameter check is what keeps
  // a handler's status-narrowed `error` (e.g. `(409, Conflict) => …`) assignable to
  // this route-agnostic base. The arrow-property form the rule prefers is
  // contravariant and would reject every endpoint that declares `errors`.
  // eslint-disable-next-line ts/method-signature-style -- bivariance is required (see above)
  error(status: StatusCodeKey, data?: unknown): HTTPError
  /** Request-scoped capabilities published by typed middleware (delta 12). */
  bindings: Bindings
  /** Route params, by name (validated/coerced inside a handler). */
  params: Record<string, unknown>
  /** The request query (validated/raw). */
  query: Record<string, unknown>
  /** The request body (validated/raw). */
  body: unknown
  /**
   * The native h3 context, with `params` widened to accept coerced values (a
   * `:id` schema can turn it into a `number`), so every handler event is assignable.
   */
  context: Omit<H3Event['context'], 'params'> & { params: Record<string, unknown> }
}

// ── the handler event ─────────────────────────────────────────────────────────

/** H3Event whose `context.params` is narrowed to the resolved params and required. */
type ValidatedH3Event<RequestT extends EventHandlerRequest, Params> = {
  [K in keyof H3Event<RequestT>]: K extends 'context'
    ? Omit<H3Event<RequestT>[K], 'params'> & { params: Params }
    : H3Event<RequestT>[K];
}

type MethodRequest<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Route extends string,
> = EventHandlerRequest & {
  body: InferMethodBody<V>
  query: InferMethodQuery<V>
  routerParams: ResolvedParams<P, Route>
}

/** Eager unless the validate block opts out with `eager: false`. */
type IsEager<V extends AnyMethodValidate> = V extends { eager: false } ? false : true

/** h3's untyped query shape, before a schema turns it into an application type. */
type RawQuery = Partial<Record<string, string | string[]>>

/**
 * The *direct* read of body/query (`event.body`, `event.context.query`). In eager
 * mode it is the validated output, established before the handler. In manual mode
 * it stays raw — `unknown` for body, h3's query shape for query — because the
 * trusted value only exists after `event.valid(scope)` runs (conventions §4).
 */
type DirectBody<V extends AnyMethodValidate> = IsEager<V> extends true ? InferMethodBody<V> : unknown
type DirectQuery<V extends AnyMethodValidate> = IsEager<V> extends true ? InferMethodQuery<V> : RawQuery

/** The validated value behind each scope. */
interface ValidValues<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Route extends string,
> {
  params: ResolvedParams<P, Route>
  query: InferMethodQuery<V>
  body: InferMethodBody<V>
  headers: InferMethodHeaders<V>
}

/** A scope `K` is validatable only when it declares a schema. */
type HasSchema<V extends AnyMethodValidate, K extends 'query' | 'body' | 'headers'>
  = V extends { [Key in K]?: infer S } ? ([S] extends [SchemaWithJSON] ? K : never) : never

/** The scopes `event.valid(...)` accepts: those with a declared schema. */
type ValidScope<V extends AnyMethodValidate, P extends SchemaWithJSON | undefined>
  = (P extends SchemaWithJSON ? 'params' : never) | HasSchema<V, 'query'> | HasSchema<V, 'body'> | HasSchema<V, 'headers'>

/** `event.valid(scope)` — runs (manual) or reads (eager) the validated value; throws → 422 on failure. */
type ValidFn<V extends AnyMethodValidate, P extends SchemaWithJSON | undefined, Route extends string>
  = <S extends ValidScope<V, P>>(scope: S) => Promise<ValidValues<V, P, Route>[S]>

/**
 * The `event` a method's handler receives. Request values read two ways, over one
 * canonical store: the root aliases `event.params/query/body` (and their
 * `event.context.*` originals), validated in eager mode and raw until `valid()` in
 * manual mode; and `event.valid(scope)`, the deliberate, idempotent validator.
 * `event.bindings` exposes the typed capabilities parent middleware published
 * (delta 12). `ExtraParams` folds in params a router owns from a dynamic outer
 * mount (`parentParams`, delta 11). See docs/dux-patterns.md §1, §10.
 */
export type MethodEvent<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Route extends string,
  Err = undefined,
  Bindings = object,
  ExtraParams = object,
> = ValidatedH3Event<MethodRequest<V, P, Route>, Prettify<ResolvedParams<P, Route> & ExtraParams>> & {
  valid: ValidFn<V, P, Route>
  /** Throw a declared error: `throw e.error(409, { … })`, checked against `errors[409]` (delta 9). */
  error: ErrorFn<Err>
  /** Request-scoped capabilities published by typed middleware (delta 12). */
  bindings: Bindings
  /** Root aliases over the canonical `event.context` storage (conventions §4, §13). */
  params: Prettify<ResolvedParams<P, Route> & ExtraParams>
  query: DirectQuery<V>
  body: DirectBody<V>
  context: {
    params: Prettify<ResolvedParams<P, Route> & ExtraParams>
    query: DirectQuery<V>
    body: DirectBody<V>
    bindings: Bindings
  }
}

/** Relaxes a `const`-captured (deeply readonly) return so it still satisfies the mutable schema output. */
export type ConstResponse<T> = T extends Date | RegExp | URL
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : T extends readonly (infer U)[]
      ? readonly ConstResponse<U>[]
      : T extends object
        ? { [K in keyof T]: ConstResponse<T[K]> }
        : T

/** A method handler: `event` typed from the validate block, params, and pattern; return matches the **success** response. */
export type MethodHandler<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Route extends string,
  M extends RouteMethod,
  Status extends number | undefined,
  Err = undefined,
  Bindings = object,
  ExtraParams = object,
> = (
  event: MethodEvent<V, P, Route, Err, Bindings, ExtraParams>,
) => IsEmptyResponse<M, Status> extends true
  ? void | null | undefined | Promise<void | null | undefined>
  : ResponseSchema<V> extends EventStream<infer T>
    ? AsyncIterable<T>
    : ResponseSchema<V> extends TextResponse
      ? string | Promise<string>
      : ResponseSchema<V> extends BinaryResponse
        ? BinaryBody | Promise<BinaryBody>
        : (Ret & ConstResponse<SuccessConstraint<V>>) | Promise<Ret & ConstResponse<SuccessConstraint<V>>>

/** The success shape a handler's return is checked against (errors are thrown, never returned). */
type SuccessConstraint<V extends AnyMethodValidate> = [ResponseSchema<V>] extends [SchemaWithJSON]
  ? InferOutput<ResponseSchema<V>>
  : ResponseSchema<V> extends Record<StatusCodeKey, SchemaWithJSON>
    ? Pick2xx<ResponseSchema<V>>
    : unknown

// ── the contract kernel (delta 7, completed in phase 9) ───────────────────────

/** The 2xx status an endpoint answers with: the declared `status`, else `200`. */
export type ResolveSuccess<Status extends number | undefined> = Status extends number ? Status : 200

/**
 * The per-status `responses` map (kernel §8): the success entry (its 2xx body +
 * response *kind*) plus one `json` entry per declared failure (response non-2xx ∪
 * `errors` ∪ the auto `422`). Per-status, never flattened — the discrimination the
 * client's typed `error` channel reads.
 */
export type EndpointResponses<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  M extends RouteMethod,
  Status extends number | undefined,
  Err,
> = Prettify<
  & { [S in ResolveSuccess<Status>]: { body: SuccessResponse<V, Ret, M, Status>, kind: SuccessKind<V, Ret, M, Status> } }
  & { [S in keyof EndpointErrors<V, P, Err>]: { body: EndpointErrors<V, P, Err>[S], kind: 'json' } }
>

/**
 * One endpoint's normalized **contract kernel** — the single shape every plane
 * reads (client, diagnostics, composition, Nitro codegen, OpenAPI). Computed once,
 * at accumulation time, into plain resolved shapes (no schema generics):
 *
 *  - `request` — what the caller supplies (`params`/`query`/`headers` as output,
 *    `body` as input); `params` is inferred from the pattern when no schema is given.
 *  - `responses` — per-status `{ body, kind }`; the success 2xx falls back to the
 *    handler's return `Ret` when no `validate.response` is declared.
 *  - `success` — the 2xx status this endpoint answers with.
 *
 * Structurally assignable to {@link EndpointContract} (internal/contract.ts). Both
 * `createServer`'s `typeof app` and Nitro's generated `#h3-dux/routes` produce it,
 * so one client is typed from either.
 */
export interface H3DuxEndpoint<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Route extends string,
  M extends RouteMethod,
  Status extends number | undefined,
  Err = undefined,
  ExtraParams = object,
> {
  request: {
    params: Prettify<ResolvedParams<P, Route> & ExtraParams>
    query: InferMethodQuery<V>
    headers: InferMethodHeaders<V>
    body: InferMethodBodyDir<V, 'input'>
  }
  responses: EndpointResponses<V, P, Ret, M, Status, Err>
  success: ResolveSuccess<Status>
}

/** A single route+method's contribution to the accumulated route map. */
export type H3DuxRouteRecord<
  Route extends string,
  M extends RouteMethod,
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Status extends number | undefined,
  Err = undefined,
  ExtraParams = object,
> = { [R in Route]: { [Method in M]: H3DuxEndpoint<V, P, Ret, Route, M, Status, Err, ExtraParams> } }

/** The bindings a handler ultimately sees: the chain's, plus any its own middleware/requires add. */
export type HandlerBindings<Bindings, Mw extends readonly any[], Req extends readonly any[]>
  = Prettify<Bindings & TupleBindings<Mw> & TupleBindings<Req>>

/**
 * The options a verb method accepts — route-level params/middleware flattened in,
 * plus `status`/`errors`. `Bindings` is the chain's accumulated middleware
 * capabilities (delta 12); `Mw`/`Req` are this endpoint's own middleware and
 * type-only requirements, whose published bindings also reach the handler.
 * `ExtraParams` carries a router's dynamically-mounted parent params (delta 11).
 */
export interface H3DuxVerbOpts<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  M extends RouteMethod,
  Ret,
  Route extends string,
  Status extends number | undefined,
  Err extends ErrorsOption | undefined = undefined,
  Bindings = object,
  ExtraParams = object,
  Mw extends readonly Middleware[] = readonly Middleware[],
  Req extends readonly any[] = readonly any[],
> {
  /** A schema for the route's `:params` — typed/coerced params opt in here (else they're `string`). */
  params?: P
  /** Middleware to register and run for this endpoint; typed ones add to `event.bindings`. */
  middleware?: Mw & ([MiddlewareTupleIssue<Mw, Bindings>] extends [never]
    ? unknown
    : MiddlewareTupleIssue<Mw, Bindings>)
  /** Type-only capability requirements an enclosing scope must already provide (delta 12). */
  requires?: Req & ([RequirementsIssue<Req, Bindings>] extends [never]
    ? unknown
    : RequirementsIssue<Req, Bindings>)
  meta?: H3RouteMeta
  /** OpenAPI operation metadata; `false` hides this operation from dux OpenAPI. */
  openapi?: H3DuxOpenAPI
  /** Success status code; sets `event.res.status` before the handler runs. */
  status?: Status
  /** Shape this method's validation errors (overrides the route/app hook). */
  onValidationError?: OnValidationError
  /**
   * Typed failure responses — a status → schema map (`{ 409: ConflictSchema }`).
   * Feeds the client's discriminated `error` and `event.error(status, data)` (delta 9).
   */
  errors?: Err
  /**
   * Request/response schemas. A {@link BodylessMethod} forbids `body` — the
   * forbidden slot carries a self-describing message so the cursor reads
   * "remove validate.body" instead of "not assignable to never". Set `eager:
   * false` for manual validation via `event.valid(...)` (default is
   * eager-sequential — params → query → headers → body, short-circuit).
   */
  validate?: ([M] extends [BodylessMethod]
    ? V & { body?: '⚠ a GET/HEAD request has no body — remove validate.body' }
    : V) & { eager?: boolean }
  handler: MethodHandler<V, P, Ret, Route, M, Status, Err, HandlerBindings<Bindings, Mw, Req>, ExtraParams>
}

/**
 * A duplicate-route guard on the *route* argument (delta 11). When the full path
 * already declares this method, the expected type becomes a self-describing
 * sentinel the real path isn't assignable to — so the duplicate is reported at
 * the cursor, with a readable message and no schema leak, instead of being
 * silently kept first-wins. `Full` is the accumulated key; `Local` is what the
 * argument should still be in the non-duplicate case (they differ under a router
 * prefix).
 */
export type DuplicateRoute<Routes, M extends string, Full extends string, Local extends string = Full>
  = Full extends keyof Routes
    ? M extends keyof Routes[Full]
      ? '⚠ this route + method is already defined — remove the duplicate'
      : Local
    : Local

/** Merge two route maps: different paths/methods compose; a method in both keeps the first. */
export type MergePair<A, B> = {
  [P in keyof A | keyof B]: P extends keyof A
    ? P extends keyof B
      ? Prettify<A[P] & Omit<B[P], keyof A[P]>>
      : A[P]
    : P extends keyof B
      ? B[P]
      : never;
}
