/**
 * The per-method type machinery for the dux server builder.
 *
 * VENDORED from `h3-route-tools` `src/route-handler.ts` + `src/internal/types.ts`
 * — these types are not part of upstream's public exports, but we need them to
 * type a handler's `event` and to derive the route contract our `createServer`
 * accumulates. Kept faithful to upstream; the fork-rebase ritual
 * (docs/dux-spec-workspace.md §6) re-checks them.
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
  BodylessMethod,
  InferInput,
  InferOutput,
  MethodValidate,
  OnValidationError,
  RouteMethod,
  SchemaWithJSON,
  StatusCodeKey,
} from 'h3-route-tools'
import type { EventStream } from '../sse.ts'

/** Flatten an intersection into a plain object type (display only). */
export type Prettify<T> = { [K in keyof T]: T[K] }

/** The declared response schema of a method (possibly `sse()`-branded), or `undefined`. */
type ResponseSchema<V extends AnyMethodValidate> = V extends { response?: infer R } ? R : undefined

export type AnyMethodValidate = MethodValidate<any, any, any, any>

// ── inference helpers (verbatim from upstream) ────────────────────────────────

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
export type SuccessResponse<V extends AnyMethodValidate, Ret> = ResponseSchema<V> extends EventStream<infer T>
  ? EventStream<T>
  : [ResponseSchema<V>] extends [SchemaWithJSON]
      ? InferOutput<ResponseSchema<V>>
      : ResponseSchema<V> extends Record<StatusCodeKey, SchemaWithJSON>
        ? Pick2xx<ResponseSchema<V>>
        : unknown extends InferMethodResponse<V> ? Ret : InferMethodResponse<V>

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

/** The params a handler sees: the schema's output if declared, else inferred from the pattern. */
type ResolvedParams<P extends SchemaWithJSON | undefined, Route extends string>
  = P extends SchemaWithJSON ? InferOutput<P> : RouteParams<Route>

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

interface ValidatedData<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Route extends string,
> {
  query: InferMethodQuery<V>
  params: ResolvedParams<P, Route>
  headers: InferMethodHeaders<V>
}

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
 * The `event` a method's handler receives. `context.params/query/body` are the
 * neutral, typed accessors (validated in eager mode, populated by `valid()` in
 * manual mode); `valid(scope)` is the deliberate, idempotent validator. See
 * docs/dux-conventions.md §4.
 */
export type MethodEvent<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Route extends string,
  Err = undefined,
> = ValidatedH3Event<MethodRequest<V, P, Route>, ResolvedParams<P, Route>> & {
  validated: ValidatedData<V, P, Route>
  valid: ValidFn<V, P, Route>
  /** Throw a declared error: `throw e.error(409, { … })`, checked against `errors[409]` (delta 9). */
  error: ErrorFn<Err>
  context: { query: InferMethodQuery<V>, body: InferMethodBody<V> }
}

/** Relaxes a `const`-captured (deeply readonly) return so it still satisfies the mutable schema output. */
type ConstResponse<T> = T extends Date | RegExp | URL
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
  Err = undefined,
> = (
  event: MethodEvent<V, P, Route, Err>,
) => ResponseSchema<V> extends EventStream<infer T>
  ? AsyncIterable<T>
  : (Ret & ConstResponse<SuccessConstraint<V>>) | Promise<Ret & ConstResponse<SuccessConstraint<V>>>

/** The success shape a handler's return is checked against (errors are thrown, never returned). */
type SuccessConstraint<V extends AnyMethodValidate> = [ResponseSchema<V>] extends [SchemaWithJSON]
  ? InferOutput<ResponseSchema<V>>
  : ResponseSchema<V> extends Record<StatusCodeKey, SchemaWithJSON>
    ? Pick2xx<ResponseSchema<V>>
    : unknown

// ── the dux contract (response + param inference are the additions) ────────────

/**
 * One method's contract. `params` is inferred from the pattern when no schema is
 * given; `response` is the **success (2xx)** body (falling back to the handler's
 * return `Ret` when no `validate.response` is declared); `errors` is the per-status
 * map of typed failures (response non-2xx ∪ declared `errors` ∪ the auto `422`).
 */
export interface DuxEndpoint<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Route extends string,
  Err = undefined,
> {
  params: ResolvedParams<P, Route>
  query: InferMethodQuery<V>
  headers: InferMethodHeaders<V>
  body: InferMethodBodyDir<V, 'input'>
  response: SuccessResponse<V, Ret>
  // Prettify so an indexed read (`E['errors']`) resolves to a flat `{ status: body }`
  // map rather than the lazy `EndpointErrors<…>` alias — keeps the client clean.
  errors: Prettify<EndpointErrors<V, P, Err>>
}

/** A single route+method's contribution to the accumulated route map. */
export type DuxRouteRecord<
  Route extends string,
  M extends RouteMethod,
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Err = undefined,
> = { [R in Route]: { [Method in M]: DuxEndpoint<V, P, Ret, Route, Err> } }

/** The options a verb method accepts — route-level params/middleware flattened in, plus `status`/`errors`. */
export interface DuxVerbOpts<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  M extends RouteMethod,
  Ret,
  Route extends string,
  Err extends ErrorsOption | undefined = undefined,
> {
  /** A schema for the route's `:params` — typed/coerced params opt in here (else they're `string`). */
  params?: P
  /** Plain h3 middleware — this is how auth attaches (never a kit concept). */
  middleware?: Middleware[]
  meta?: H3RouteMeta
  /** Success status code; sets `event.res.status` before the handler runs. */
  status?: number
  /** Shape this method's validation errors (overrides the route/app hook). */
  onValidationError?: OnValidationError
  /**
   * Typed failure responses — a status → schema map (`{ 409: ConflictSchema }`).
   * Feeds the client's discriminated `error` and `event.error(status, data)` (delta 9).
   */
  errors?: Err
  /**
   * Request/response schemas. A {@link BodylessMethod} forbids `body`. Set
   * `eager: false` for manual validation via `event.valid(...)` (default is
   * eager-sequential — params → query → headers → body, short-circuit).
   */
  validate?: ([M] extends [BodylessMethod] ? V & { body?: never } : V) & { eager?: boolean }
  handler: MethodHandler<V, P, Ret, Route, Err>
}

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
