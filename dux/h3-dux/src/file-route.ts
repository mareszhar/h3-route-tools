/**
 * Nitro file routes, dux-native (delta 13). `defineFileRoute(def)` carries every
 * standalone delta — validation modes, response inference and kinds, SSE, typed
 * errors, the root event accessors, and typed middleware bindings — into a Nitro
 * filesystem route, whose path and (when suffixed) method come from the filename.
 * `createFileRouteFactory()` produces the same definition surface with accumulated
 * middleware capabilities, composable across files. See docs/dux-spec.md §13.
 *
 * Two authoring shapes, picked by the def:
 *  - **flat** — one handler (`{ validate?, handler, … }`). A `*.post.ts` filename
 *    owns the method; an unsuffixed file shares it across every method. There are
 *    no `.get()`/`.post()` methods — repeating a filename-owned method in source
 *    could contradict it.
 *  - **method map** — distinct contracts per method (`{ params?, get, post, … }`),
 *    for an unsuffixed file that answers several methods. Params are route-wide.
 *
 * Runtime: the built handler self-dispatches (reusing h3-dux's owned `defineRouteHandler`
 * for routing + request validation) and replays its middleware onion inside the
 * matched route. A type-only kernel brand (`~duxFlat`/`~duxMethods`) is what the
 * Nitro codegen reads to emit `#h3-dux/routes` (phase 9C).
 */
import type { EventHandlerWithFetch, H3Event, H3RouteMeta, Middleware } from 'h3'
import type { ClientData } from './internal/contract.ts'
import type { H3DuxMeta, H3DuxOpenAPI, H3DuxOpenAPIObject } from './internal/openapi-types.ts'
import type {
  AnyMethodValidate,
  ErrorsOption,
  H3DuxEndpoint,
  H3DuxVerbOpts,
  HandlerBindings,
  InferMethodResponse,
  MethodHandler,
} from './internal/route-types.ts'
import type { OnValidationError, SchemaWithJSON } from './internal/schema-types.ts'
import type {
  BindingsOf,
  MiddlewareTupleIssue,
  RequirementsIssue,
  TypedMiddleware,
  UnsatisfiedKeys,
  UsableMiddleware,
} from './middleware.ts'
import type {
  BodylessMethod,
  MethodValidate,
  RouteMethod,
} from './route.ts'
import { defineHandler } from 'h3'
import { mergeOpenAPI } from './internal/openapi-types.ts'
import { buildMethod } from './internal/runtime.ts'
import { toMiddleware } from './middleware.ts'
import { defineRouteHandler } from './route.ts'

/** The callable methods a file route's client surface can expose. */
type CallableMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'

/**
 * A built dux file route: a real h3 handler plus type-only kernel brands the Nitro
 * codegen reads. `~duxFlat` carries a single method-neutral contract (the flat
 * form — codegen assigns it the filename's method[s]); `~duxMethods` carries a
 * per-method map (the method-map form). Exactly one is populated.
 */
export interface H3DuxFileHandler<Flat = never, Methods = never> extends EventHandlerWithFetch {
  /** Runtime marker: this is a dux file route (read by the Nitro module). */
  readonly '~duxFile': true
  /** Type-only: the flat form's method-neutral contract kernel. */
  readonly '~duxFlat'?: Flat
  /** Type-only: the method-map form's per-method contract kernels. */
  readonly '~duxMethods'?: Methods
  /** Runtime OpenAPI metadata for the Nitro OpenAPI collector. */
  readonly '~duxOpenAPI'?: H3DuxFileOpenAPI
}

export interface H3DuxFileOpenAPI {
  params?: SchemaWithJSON
  methods: Partial<Record<RouteMethod, {
    validate?: AnyMethodValidate & { eager?: boolean }
    status?: number
    errors?: ErrorsOption
    openapi?: H3DuxOpenAPIObject
  }>>
}

// ── codegen projection (type-only; consumed by the generated `#h3-dux/routes`) ─
// The Nitro codegen reads these to turn a built file handler into kernel endpoints
// keyed by the *filename*'s path/method. They live here so the source of the kernel
// shape and its projection stay together (one source of truth, dux-vision.md §4.4).
// Codegen emits only data (path → handler import, filename params, locked methods);
// these types do all projection, method re-keying, filtering, and the filename-truth
// assertions. The Nitro collector still imports route modules once to read the
// runtime form marker; the generated `#h3-dux/routes` module itself is type-only.

/** The flat form's method-neutral source — the ingredients codegen re-keys per method. */
export type FlatContract<H> = H extends { '~duxFlat'?: infer F } ? Exclude<F, undefined> : never

/** The method-map form's per-method contracts, recovered from a built handler. */
export type FileMethods<H> = H extends { '~duxMethods'?: infer M } ? Exclude<M, undefined> : never

/**
 * Instantiate the flat source as a concrete endpoint kernel for the filename's
 * method `M`. The same `H3DuxEndpoint` the standalone builder produces, so the
 * method-owned facts a filename carries — `head`/`204`/`205` answer empty, the
 * success kind — are applied *once*, here, instead of being re-encoded (principle 2).
 * Authoring is method-neutral (the filename isn't known at the cursor); the method
 * is bound at generation, when codegen knows the path.
 */
export type AsMethod<Source, M extends RouteMethod>
  = Source extends FlatSource<infer V, infer P, infer Ret, infer Status, infer Err>
    ? H3DuxEndpoint<V, P, Ret, '/', M, Status, Err, object>
    : never

/**
 * Resolve a file route's client params: the *filename*-derived `{ name: string }`
 * when the handler declared none (a broad `Record<string, string>`), else the
 * declared schema's logical/coerced type. The key-agreement assertion ({@link
 * AssertFileRoute}) checks a declared schema's keys against the filename separately.
 */
export type ResolveFileParams<Declared, FromFilename>
  = string extends keyof Declared ? FromFilename : Declared

/** Override an endpoint kernel's `request.params` with the filename-derived params. */
export type WithFilenameParams<E, Params> = E extends { request: infer Req }
  ? Omit<E, 'request'> & {
    request: Omit<Req, 'params'> & {
      params: ResolveFileParams<Req extends { params: infer P } ? P : object, Params>
    }
  }
  : E

/** A flat endpoint kernel re-keyed to the filename's method, with filename params applied. */
export type FileFlatContract<H, M extends RouteMethod, Params>
  = WithFilenameParams<AsMethod<FlatContract<H>, M>, Params>

/** The value Nitro's `$fetch`/`InternalApi` exposes for one dux endpoint. */
export type NitroDataOf<E> = ClientData<E>

// ── the filename-truth assertion (emitted by codegen; fails project typecheck) ─
// `WithFilenameParams` keeps the *client* honest (it applies the filename params);
// this keeps the *author* honest — a declared params schema must agree with the
// filename path, so `/fruits/[id].get.ts` cannot quietly declare `params: { slug }`.
// The reachability and shared-body contradictions are runtime-inspectable, so the
// Nitro module rejects them at generation; this shape-only check rides the project
// typecheck. Codegen records each file's form, so the right brand is read directly —
// the type does not have to (and cannot) tell the forms apart on its own.

/** Filename param names (`'id'`) from the literal codegen emits (`{ id: string }`); `never` if static. */
type FilenameNames<Params> = Extract<keyof Params, string>

/** A declared params schema must cover exactly the filename's `:params` — no more, no fewer. */
type AssertFilenameParams<Declared, Names extends string>
  = string extends keyof Declared
    ? true // no params schema → the filename wins; nothing to verify
    : [Exclude<Extract<keyof Declared, string>, Names>] extends [never]
        ? [Exclude<Names, keyof Declared>] extends [never]
            ? true
            : { '⚠ params schema is missing a key the filename path declares': Exclude<Names, keyof Declared> }
        : { '⚠ params schema declares a key the filename path does not have': Exclude<Extract<keyof Declared, string>, Names> }

/** The route's declared params, read from whichever brand the file's form populates. */
type FlatParams<H> = AsMethod<FlatContract<H>, 'post'> extends { request: { params: infer P } } ? P : object
type MapParams<H> = FileMethods<H>[keyof FileMethods<H>] extends { request: { params: infer P } } ? P : object

/**
 * The per-file params assertion codegen emits, wrapped in `Expect<…>` so a schema
 * that disagrees with the filename path fails typecheck at the cursor. `Form` is the
 * authoring form codegen recorded, so the matching brand is read.
 */
export type AssertFileRoute<H, Params, Form extends 'flat' | 'methods'>
  = AssertFilenameParams<Form extends 'flat' ? FlatParams<H> : MapParams<H>, FilenameNames<Params>>

/** Fails to instantiate (and so fails typecheck) unless `T` is exactly `true`. */
export type Expect<T extends true> = T

// ── the flat form ─────────────────────────────────────────────────────────────
// Reuses the standalone verb options verbatim (`H3DuxVerbOpts`), typed for a generic
// body-bearing method at the route-free pattern `'/'`: with no params schema the
// handler sees `Record<string, string>` (codegen replaces it with the exact
// filename params), and the success/kind/errors are inferred exactly as a verb's.
// A `get`/`head` filename forbidding a body is a generation assertion, not a cursor
// error, because the filename isn't visible while the handler is authored.

/** The flat-form definition — one handler; the filename owns the method and path. */
type FlatDef<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Status extends number | undefined,
  Err extends ErrorsOption | undefined,
  Bindings,
  Mw extends readonly Middleware[],
  Req extends readonly TypedMiddleware<any, any>[],
> = H3DuxVerbOpts<V, P, 'post', Ret, '/', Status, Err, Bindings, object, Mw, Req>

/**
 * The flat form's method-neutral source brand — the ingredients codegen re-keys
 * into a concrete `H3DuxEndpoint` for the filename's method via {@link AsMethod}.
 * Carrying the source (not a pre-baked `'post'` endpoint) is what lets a `*.get.ts`
 * and a `*.head.ts` project honestly from one authored handler. Type-only.
 */
export interface FlatSource<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Status extends number | undefined,
  Err extends ErrorsOption | undefined,
> {
  readonly '~v'?: V
  readonly '~p'?: P
  readonly '~ret'?: Ret
  readonly '~status'?: Status
  readonly '~err'?: Err
}

// ── the method-map form ───────────────────────────────────────────────────────
// One contract per method on an unsuffixed file. Params are route-wide (outer);
// query/body/headers/response stay per method. Per-method validate (`V`), status,
// and errors are inferred exactly as a verb's; per-method response inference rides
// a `const` response record so inline literals survive.

/** One method's def inside a method map — the verb options minus the route-wide `params`/`meta`. */
interface MethodDef<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  M extends RouteMethod,
  Ret,
  Status extends number | undefined,
  Err extends ErrorsOption | undefined,
  Bindings,
> {
  status?: Status
  onValidationError?: OnValidationError
  errors?: Err
  openapi?: H3DuxOpenAPI
  validate?: ([M] extends [BodylessMethod] ? V & { body?: never } : V) & { eager?: boolean }
  handler: MethodHandler<V, P, Ret, '/', M, Status, Err, Bindings, object>
}

/** Per-method inferred validate types, keyed by method (picks each method's `V`). */
interface MethodValidates<Get, Post, Put, Patch, Del, Head, Options> {
  get: Get
  post: Post
  put: Put
  patch: Patch
  delete: Del
  head: Head
  options: Options
}
interface MethodRets<GetRet, PostRet, PutRet, PatchRet, DelRet, HeadRet, OptionsRet> {
  get: GetRet
  post: PostRet
  put: PutRet
  patch: PatchRet
  delete: DelRet
  head: HeadRet
  options: OptionsRet
}
interface MethodStatuses<GetS, PostS, PutS, PatchS, DelS, HeadS, OptionsS> {
  get: GetS
  post: PostS
  put: PutS
  patch: PatchS
  delete: DelS
  head: HeadS
  options: OptionsS
}
interface MethodErrs<GetE, PostE, PutE, PatchE, DelE, HeadE, OptionsE> {
  get: GetE
  post: PostE
  put: PutE
  patch: PatchE
  delete: DelE
  head: HeadE
  options: OptionsE
}

/**
 * The method-map definition. `K` (inferred via `Record<K, unknown>`) is the set of
 * declared method keys, so only declared methods enter the kernel brand. Route-level
 * `middleware`/`requires` run for *every* method and publish typed bindings into all
 * the handlers — parity with the flat form and the verb surface. For middleware that
 * differs *per method* (public `GET`, authenticated `POST`), give each its own
 * `*.<method>.ts` file; one file, one method is the delightful expression of that.
 */
interface MethodMapDef<
  P extends SchemaWithJSON | undefined,
  Bindings,
  Mw extends readonly Middleware[],
  Req extends readonly TypedMiddleware<any, any>[],
  Get extends AnyMethodValidate,
  Post extends AnyMethodValidate,
  Put extends AnyMethodValidate,
  Patch extends AnyMethodValidate,
  Del extends AnyMethodValidate,
  Head extends AnyMethodValidate,
  Options extends AnyMethodValidate,
  GetRet,
  PostRet,
  PutRet,
  PatchRet,
  DelRet,
  HeadRet,
  OptionsRet,
  GetS extends number | undefined,
  PostS extends number | undefined,
  PutS extends number | undefined,
  PatchS extends number | undefined,
  DelS extends number | undefined,
  HeadS extends number | undefined,
  OptionsS extends number | undefined,
  GetE extends ErrorsOption | undefined,
  PostE extends ErrorsOption | undefined,
  PutE extends ErrorsOption | undefined,
  PatchE extends ErrorsOption | undefined,
  DelE extends ErrorsOption | undefined,
  HeadE extends ErrorsOption | undefined,
  OptionsE extends ErrorsOption | undefined,
> {
  /** A schema for the route's `:params` — route-wide across every method. */
  params?: P
  meta?: H3RouteMeta
  /** Middleware run for every method; typed providers publish into every handler's `event.bindings`. */
  middleware?: Mw & ([MiddlewareTupleIssue<Mw, Bindings>] extends [never]
    ? unknown
    : MiddlewareTupleIssue<Mw, Bindings>)
  /** Type-only capability requirements an enclosing scope must already provide (delta 12). */
  requires?: Req & ([RequirementsIssue<Req, Bindings>] extends [never]
    ? unknown
    : RequirementsIssue<Req, Bindings>)
  /** Default validation-error hook for every method; a method's own overrides it. */
  onValidationError?: OnValidationError
  get?: MethodDef<Get, P, 'get', GetRet, GetS, GetE, HandlerBindings<Bindings, Mw, Req>>
  post?: MethodDef<Post, P, 'post', PostRet, PostS, PostE, HandlerBindings<Bindings, Mw, Req>>
  put?: MethodDef<Put, P, 'put', PutRet, PutS, PutE, HandlerBindings<Bindings, Mw, Req>>
  patch?: MethodDef<Patch, P, 'patch', PatchRet, PatchS, PatchE, HandlerBindings<Bindings, Mw, Req>>
  delete?: MethodDef<Del, P, 'delete', DelRet, DelS, DelE, HandlerBindings<Bindings, Mw, Req>>
  head?: MethodDef<Head, P, 'head', HeadRet, HeadS, HeadE, HandlerBindings<Bindings, Mw, Req>>
  options?: MethodDef<Options, P, 'options', OptionsRet, OptionsS, OptionsE, HandlerBindings<Bindings, Mw, Req>>
}

/** The method-map form's per-method contract kernels — only the declared methods. */
type MethodMapEndpoints<
  K extends string,
  P extends SchemaWithJSON | undefined,
  V extends MethodValidates<any, any, any, any, any, any, any>,
  R extends MethodRets<any, any, any, any, any, any, any>,
  S extends MethodStatuses<any, any, any, any, any, any, any>,
  E extends MethodErrs<any, any, any, any, any, any, any>,
> = {
  [M in CallableMethod as M extends K ? M : never]: H3DuxEndpoint<
    V[M],
    P,
    R[M],
    '/',
    M,
    S[M],
    E[M] & (ErrorsOption | undefined),
    object
  >
}

/** Keys the method-map branch may capture when deriving declared methods. */
type MethodMapAuthorKey
  = | 'params'
    | 'meta'
    | 'middleware'
    | 'requires'
    | 'onValidationError'
    | CallableMethod

type FileRouteArg<
  Form extends 'flat' | 'methods',
  K extends MethodMapAuthorKey,
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Status extends number | undefined,
  Err extends ErrorsOption | undefined,
  Bindings,
  Mw extends readonly Middleware[],
  Req extends readonly TypedMiddleware<any, any>[],
  Get extends AnyMethodValidate,
  Post extends AnyMethodValidate,
  Put extends AnyMethodValidate,
  Patch extends AnyMethodValidate,
  Del extends AnyMethodValidate,
  Head extends AnyMethodValidate,
  Options extends AnyMethodValidate,
  GetRet,
  PostRet,
  PutRet,
  PatchRet,
  DelRet,
  HeadRet,
  OptionsRet,
  GetS extends number | undefined,
  PostS extends number | undefined,
  PutS extends number | undefined,
  PatchS extends number | undefined,
  DelS extends number | undefined,
  HeadS extends number | undefined,
  OptionsS extends number | undefined,
  GetE extends ErrorsOption | undefined,
  PostE extends ErrorsOption | undefined,
  PutE extends ErrorsOption | undefined,
  PatchE extends ErrorsOption | undefined,
  DelE extends ErrorsOption | undefined,
  HeadE extends ErrorsOption | undefined,
  OptionsE extends ErrorsOption | undefined,
> = Form extends 'flat'
  ? | FlatDef<V, P, Ret, Status, Err, Bindings, Mw, Req>
  | MethodHandler<MethodValidate, undefined, Ret, '/', 'post', undefined, undefined, Bindings, object>
  : MethodMapDef<
    P,
    Bindings,
    Mw,
    Req,
    Get,
    Post,
    Put,
    Patch,
    Del,
    Head,
    Options,
    GetRet,
    PostRet,
    PutRet,
    PatchRet,
    DelRet,
    HeadRet,
    OptionsRet,
    GetS,
    PostS,
    PutS,
    PatchS,
    DelS,
    HeadS,
    OptionsS,
    GetE,
    PostE,
    PutE,
    PatchE,
    DelE,
    HeadE,
    OptionsE
  > & Record<K, unknown>

type FileRouteReturn<
  Form extends 'flat' | 'methods',
  K extends MethodMapAuthorKey,
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Status extends number | undefined,
  Err extends ErrorsOption | undefined,
  Get extends AnyMethodValidate,
  Post extends AnyMethodValidate,
  Put extends AnyMethodValidate,
  Patch extends AnyMethodValidate,
  Del extends AnyMethodValidate,
  Head extends AnyMethodValidate,
  Options extends AnyMethodValidate,
  GetRet,
  PostRet,
  PutRet,
  PatchRet,
  DelRet,
  HeadRet,
  OptionsRet,
  GetS extends number | undefined,
  PostS extends number | undefined,
  PutS extends number | undefined,
  PatchS extends number | undefined,
  DelS extends number | undefined,
  HeadS extends number | undefined,
  OptionsS extends number | undefined,
  GetE extends ErrorsOption | undefined,
  PostE extends ErrorsOption | undefined,
  PutE extends ErrorsOption | undefined,
  PatchE extends ErrorsOption | undefined,
  DelE extends ErrorsOption | undefined,
  HeadE extends ErrorsOption | undefined,
  OptionsE extends ErrorsOption | undefined,
> = Form extends 'flat'
  ? H3DuxFileHandler<FlatSource<V, P, Ret, Status, Err>, never>
  : H3DuxFileHandler<never, MethodMapEndpoints<
    K,
    P,
    MethodValidates<Get, Post, Put, Patch, Del, Head, Options>,
    MethodRets<GetRet, PostRet, PutRet, PatchRet, DelRet, HeadRet, OptionsRet>,
    MethodStatuses<GetS, PostS, PutS, PatchS, DelS, HeadS, OptionsS>,
    MethodErrs<GetE, PostE, PutE, PatchE, DelE, HeadE, OptionsE>
  >>

// ── the definer (shared by `defineFileRoute` and a factory's call) ────────────

/**
 * The callable surface of `defineFileRoute` and every factory. One signature
 * accepts the flat form (including a bare handler) or the method-map form, so a
 * malformed definition reports at the offending property instead of through an
 * overload wall. `Bindings` are the capabilities the factory's middleware already
 * published; the handlers read them as `event.bindings`.
 */
export interface FileRouteDefiner<Bindings = object> {
  <
    Form extends 'flat' | 'methods',
    K extends MethodMapAuthorKey = never,
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
    const Status extends number | undefined = undefined,
    Err extends ErrorsOption | undefined = undefined,
    const Mw extends readonly Middleware[] = readonly Middleware[],
    const Req extends readonly TypedMiddleware<any, any>[] = readonly TypedMiddleware<any, any>[],
    Get extends AnyMethodValidate = MethodValidate,
    Post extends AnyMethodValidate = MethodValidate,
    Put extends AnyMethodValidate = MethodValidate,
    Patch extends AnyMethodValidate = MethodValidate,
    Del extends AnyMethodValidate = MethodValidate,
    Head extends AnyMethodValidate = MethodValidate,
    Options extends AnyMethodValidate = MethodValidate,
    GetRet = InferMethodResponse<Get>,
    PostRet = InferMethodResponse<Post>,
    PutRet = InferMethodResponse<Put>,
    PatchRet = InferMethodResponse<Patch>,
    DelRet = InferMethodResponse<Del>,
    HeadRet = InferMethodResponse<Head>,
    OptionsRet = InferMethodResponse<Options>,
    const GetS extends number | undefined = undefined,
    const PostS extends number | undefined = undefined,
    const PutS extends number | undefined = undefined,
    const PatchS extends number | undefined = undefined,
    const DelS extends number | undefined = undefined,
    const HeadS extends number | undefined = undefined,
    const OptionsS extends number | undefined = undefined,
    GetE extends ErrorsOption | undefined = undefined,
    PostE extends ErrorsOption | undefined = undefined,
    PutE extends ErrorsOption | undefined = undefined,
    PatchE extends ErrorsOption | undefined = undefined,
    DelE extends ErrorsOption | undefined = undefined,
    HeadE extends ErrorsOption | undefined = undefined,
    OptionsE extends ErrorsOption | undefined = undefined,
  >(
    def: FileRouteArg<
      Form,
      K,
      V,
      P,
      Ret,
      Status,
      Err,
      Bindings,
      Mw,
      Req,
      Get,
      Post,
      Put,
      Patch,
      Del,
      Head,
      Options,
      GetRet,
      PostRet,
      PutRet,
      PatchRet,
      DelRet,
      HeadRet,
      OptionsRet,
      GetS,
      PostS,
      PutS,
      PatchS,
      DelS,
      HeadS,
      OptionsS,
      GetE,
      PostE,
      PutE,
      PatchE,
      DelE,
      HeadE,
      OptionsE
    >,
  ): FileRouteReturn<
    Form,
    K,
    V,
    P,
    Ret,
    Status,
    Err,
    Get,
    Post,
    Put,
    Patch,
    Del,
    Head,
    Options,
    GetRet,
    PostRet,
    PutRet,
    PatchRet,
    DelRet,
    HeadRet,
    OptionsRet,
    GetS,
    PostS,
    PutS,
    PatchS,
    DelS,
    HeadS,
    OptionsS,
    GetE,
    PostE,
    PutE,
    PatchE,
    DelE,
    HeadE,
    OptionsE
  >
}

// ── the factory ───────────────────────────────────────────────────────────────

/** The chainable factory operations — present whether or not requirements are open. */
interface FactoryOps<Bindings, Requires> {
  /**
   * Register a middleware provider (chainable): runs it for every file route this
   * factory defines and publishes its `event.bindings` to their handlers. Two
   * providers may not publish the same key.
   */
  use: <M extends TypedMiddleware<any, any>>(
    middleware: UsableMiddleware<M, Bindings>,
  ) => FileRouteFactory<Prettify<Bindings & BindingsOf<M>>, Requires>
  /**
   * Depend on a capability a *parent* factory must provide via `.compose(...)`,
   * without registering it here. Until composed the factory is **not callable**.
   */
  requires: <M extends TypedMiddleware<any, any>>(
    provider: M,
  ) => FileRouteFactory<Prettify<Bindings & BindingsOf<M>>, Prettify<Requires & BindingsOf<M>>>
  /**
   * Satisfy a feature factory's open requirements and fold in its providers,
   * returning a callable factory. Checked like router `.mount()`: the requirements
   * must be present and assignable, and providers may not collide. Middleware the
   * parent already runs (a feature `requires`) is not registered again; a provider
   * both factories *register* (`.use`) is a collision, since it would run twice.
   */
  compose: <FB, FR>(
    feature: FileRouteFactory<FB, FR> & ComposeIssue<FB, FR, Bindings, Requires>,
  ) => FileRouteFactory<Prettify<Bindings & FB>, Requires>
}

/** A factory's *locally registered* providers: its bindings minus the ones it only requires. */
type LocalProviders<Bindings, Requires> = Omit<Bindings, keyof Requires>

/**
 * Guard `.compose(feature)`. First the feature's requirements must be present and
 * assignable in the parent's bindings; then the two factories' *registered* providers
 * (each minus what it merely requires) must not overlap, because both would run — the
 * same law `.use` and router `.mount` enforce ([dux-patterns.md §9](../docs/dux-patterns.md#9-composition--scope)).
 */
type ComposeIssue<FB, FR, Bindings, Requires>
  = [UnsatisfiedKeys<FR, Bindings>] extends [never]
    ? [Extract<keyof LocalProviders<FB, FR>, keyof LocalProviders<Bindings, Requires>>] extends [never]
        ? unknown
        : { '⚠ compose: both factories already register this binding — only one may provide it': Extract<keyof LocalProviders<FB, FR>, keyof LocalProviders<Bindings, Requires>> }
    : { '⚠ compose is missing a required binding the feature depends on': UnsatisfiedKeys<FR, Bindings> }

/**
 * A file-route factory. It is **callable** (the same surface as `defineFileRoute`,
 * with `Bindings` already in scope) only while it has no open `Requires`; a factory
 * with unresolved `.requires(...)` exposes the chainable ops but no call signature,
 * so it must be `.compose`d into a satisfying parent before use.
 */
export type FileRouteFactory<Bindings = object, Requires = object>
  = FactoryOps<Bindings, Requires>
    & ([keyof Requires] extends [never] ? FileRouteDefiner<Bindings> : object)

/** Flatten an intersection for display. */
type Prettify<T> = { [K in keyof T]: T[K] }

// ── runtime ───────────────────────────────────────────────────────────────────

/** The runtime view of a file-route def — both shapes, read permissively. */
interface RuntimeDef {
  params?: SchemaWithJSON
  meta?: H3DuxMeta
  openapi?: H3DuxOpenAPI
  middleware?: Middleware[]
  onValidationError?: OnValidationError
  status?: number
  errors?: ErrorsOption
  validate?: AnyMethodValidate & { eager?: boolean }
  handler?: (event: H3Event) => unknown
  get?: RuntimeMethod
  post?: RuntimeMethod
  put?: RuntimeMethod
  patch?: RuntimeMethod
  delete?: RuntimeMethod
  head?: RuntimeMethod
  options?: RuntimeMethod
}
interface RuntimeMethod {
  status?: number
  onValidationError?: OnValidationError
  errors?: ErrorsOption
  openapi?: H3DuxOpenAPI
  validate?: AnyMethodValidate & { eager?: boolean }
  handler: (event: H3Event) => unknown
}

const CALLABLE: readonly CallableMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
/** Methods a flat handler is registered under; HEAD is served by the route dispatcher's auto-HEAD. */
const FLAT_METHODS: readonly RouteMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'options']

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The middleware onion: run each provider around the inner (routing) handler. */
function runMiddleware(
  event: H3Event,
  middleware: readonly Middleware[],
  inner: (event: H3Event) => unknown,
): Promise<unknown> {
  const dispatch = (index: number): unknown => {
    const mw = middleware[index]
    if (!mw)
      return inner(event)
    return mw(event, () => Promise.resolve(dispatch(index + 1)))
  }
  return Promise.resolve(dispatch(0))
}

/** A loose call to the heavily-generic `defineRouteHandler` from a runtime-built def. */
type DefineBaselineRoute = (def: Record<string, unknown>, options?: unknown) => EventHandlerWithFetch & Record<string, unknown>

/** Build the runtime handler for a file-route def, prepending the factory's middleware. */
function buildFileHandler(
  input: RuntimeDef | ((event: H3Event) => unknown),
  factoryMiddleware: readonly Middleware[],
): H3DuxFileHandler {
  // A def can be the options object or a bare handler when defaults suffice.
  const def: RuntimeDef = typeof input === 'function' ? { handler: input } : input
  const routeMiddleware = (def.middleware ?? []).map(toMiddleware)
  const middleware = [...factoryMiddleware, ...routeMiddleware]
  const routeDef: Record<string, unknown> = {
    params: def.params,
    meta: { ...def.meta, openapi: mergeOpenAPI(def.meta?.openapi, def.openapi) },
    onValidationError: def.onValidationError,
  }
  const docs: H3DuxFileOpenAPI = { params: def.params, methods: {} }

  const mapped = CALLABLE.filter(method => isObject(def[method]))
  const form: 'flat' | 'methods' = mapped.length > 0 ? 'methods' : 'flat'
  if (mapped.length > 0) {
    for (const method of mapped) {
      const md = def[method] as RuntimeMethod
      const openapi = mergeOpenAPI(def.meta?.openapi, def.openapi, md.openapi)
      routeDef[method] = buildMethod(method, {
        status: md.status,
        onValidationError: md.onValidationError ?? def.onValidationError,
        errors: md.errors,
        validate: md.validate,
        handler: md.handler,
      })
      docs.methods[method] = {
        validate: md.validate,
        status: md.status,
        errors: md.errors,
        openapi,
      }
    }
  }
  else if (def.handler) {
    // Flat: the same handler serves every method (the filename narrows which arrive).
    for (const method of FLAT_METHODS) {
      const openapi = mergeOpenAPI(def.meta?.openapi, def.openapi)
      routeDef[method] = buildMethod(method, {
        status: def.status,
        onValidationError: def.onValidationError,
        errors: def.errors,
        validate: def.validate,
        handler: def.handler,
      })
      docs.methods[method] = {
        validate: def.validate,
        status: def.status,
        errors: def.errors,
        openapi,
      }
    }
  }

  const inner = (defineRouteHandler as unknown as DefineBaselineRoute)(routeDef, { errors: false })
  const handler = middleware.length > 0
    ? defineHandler({ handler: (event: H3Event) => runMiddleware(event, middleware, inner) })
    : inner

  return Object.assign(handler, {
    '~duxFile': true as const,
    // Runtime form markers the Nitro module reads to pick a route's projection and to
    // diagnose runtime-inspectable contradictions (an unreachable-method file, a
    // body-bearing shared handler). They exist because the *type* cannot tell the two
    // authoring forms apart — the definer infers both kernel brands as a union, so the
    // form is genuinely ambiguous in the type and only the value records which was written.
    '~duxForm': form,
    '~duxDeclared': form === 'methods' ? mapped : [],
    '~duxFlatHasBody': form === 'flat' && !!def.validate?.body,
    '~duxOpenAPI': docs,
    '~routeDef': inner['~routeDef'],
    '~options': inner['~options'],
  }) as unknown as H3DuxFileHandler
}

/** Private storage for a factory's accumulated middleware (kept off the public surface). */
const FACTORY_MIDDLEWARE: unique symbol = Symbol('h3dux.factoryMiddleware')

/** Construct a callable factory carrying `middleware`; `.use/.requires/.compose` derive new ones. */
function makeFactory(middleware: readonly Middleware[]): FileRouteFactory<any, any> {
  const factory = ((def: RuntimeDef) => buildFileHandler(def, middleware)) as unknown as
    FileRouteFactory<any, any> & { [FACTORY_MIDDLEWARE]: readonly Middleware[] }

  Object.defineProperty(factory, FACTORY_MIDDLEWARE, { value: middleware })
  factory.use = (mw: unknown) => makeFactory([...middleware, toMiddleware(mw as Middleware)])
  // `.requires` registers nothing at runtime — it only records a type requirement.
  factory.requires = () => makeFactory(middleware)
  factory.compose = (feature: unknown) =>
    makeFactory([...middleware, ...((feature as { [FACTORY_MIDDLEWARE]?: readonly Middleware[] })[FACTORY_MIDDLEWARE] ?? [])])
  return factory
}

/**
 * Define a dux Nitro file route. The zero-provider convenience definer — the same
 * engine as a factory's call, with no middleware capabilities added. The filename
 * owns the path and, when suffixed, the method (`checkout.post.ts` → `POST
 * /checkout`); there are no `.get()`/`.post()` methods on it.
 */
export const defineFileRoute: FileRouteDefiner<object>
  = ((def: RuntimeDef) => buildFileHandler(def, [])) as unknown as FileRouteDefiner<object>

/**
 * Create a file-route factory: a reusable definer that carries typed middleware
 * into independently authored route files. `.use(provider)` runs and publishes a
 * capability; `.requires(provider)` declares a parent-supplied one (and makes the
 * factory non-callable until `.compose`d); `.compose(feature)` satisfies a feature
 * factory's requirements and returns a callable definer. The file-route
 * counterpart of router `.mount()`.
 */
export function createFileRouteFactory(): FileRouteFactory<object, object> {
  return makeFactory([]) as FileRouteFactory<object, object>
}
