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
 * Runtime: the built handler self-dispatches (reusing upstream's `defineRouteHandler`
 * for routing + request validation) and replays its middleware onion inside the
 * matched route. A type-only kernel brand (`~duxFlat`/`~duxMethods`) is what the
 * Nitro codegen reads to emit `#h3-dux/routes` (phase 9C).
 */
import type { EventHandlerWithFetch, H3Event, H3RouteMeta, Middleware } from 'h3'
import type {
  BodylessMethod,
  MethodValidate,
  OnValidationError,
  RouteMethod,
  SchemaWithJSON,
} from 'h3-route-tools'
import type {
  AnyMethodValidate,
  DuxEndpoint,
  DuxVerbOpts,
  ErrorsOption,
  InferMethodResponse,
  MethodHandler,
} from './internal/route-types.ts'
import type {
  BindingsOf,
  TypedMiddleware,
  UnsatisfiedKeys,
  UsableMiddleware,
} from './middleware.ts'
import { defineHandler } from 'h3'
import { defineRouteHandler } from 'h3-route-tools'
import { buildMethod } from './internal/runtime.ts'
import { toMiddleware } from './middleware.ts'

/** The callable methods a file route's client surface can expose. */
type CallableMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'

/**
 * A built dux file route: a real h3 handler plus type-only kernel brands the Nitro
 * codegen reads. `~duxFlat` carries a single method-neutral contract (the flat
 * form — codegen assigns it the filename's method[s]); `~duxMethods` carries a
 * per-method map (the method-map form). Exactly one is populated.
 */
export interface DuxFileHandler<Flat = never, Methods = never> extends EventHandlerWithFetch {
  /** Runtime marker: this is a dux file route (read by the Nitro module). */
  readonly '~duxFile': true
  /** Type-only: the flat form's method-neutral contract kernel. */
  readonly '~duxFlat'?: Flat
  /** Type-only: the method-map form's per-method contract kernels. */
  readonly '~duxMethods'?: Methods
}

// ── codegen projection (type-only; consumed by the generated `#h3-dux/routes`) ─
// The Nitro codegen reads these to turn a built file handler into kernel endpoints
// keyed by the *filename*'s path/method. They live here so the source of the kernel
// shape and its projection stay together (one source of truth, dux-vision.md §4.4).

/** The flat form's method-neutral contract, recovered from a built handler. */
export type FlatContract<H> = H extends { '~duxFlat'?: infer F } ? F : never

/** The method-map form's per-method contracts, recovered from a built handler. */
export type FileMethods<H> = H extends { '~duxMethods'?: infer M } ? M : never

/**
 * Resolve a file route's client params: the *filename*-derived `{ name: string }`
 * when the handler declared none (a broad `Record<string, string>`), else the
 * declared schema's logical/coerced type. Codegen's key-agreement assertion checks
 * a declared schema's keys against the filename separately (the honest boundary).
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

// ── the flat form ─────────────────────────────────────────────────────────────
// Reuses the standalone verb options verbatim (`DuxVerbOpts`), typed for a generic
// body-bearing method at the route-free pattern `'/'`: with no params schema the
// handler sees `Record<string, string>` (codegen replaces it with the exact
// filename params), and the success/kind/errors are inferred exactly as a verb's.

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
> = DuxVerbOpts<V, P, 'post', Ret, '/', Status, Err, Bindings, object, Mw, Req>

/** The flat form's contract kernel — what codegen keys under the filename's method. */
type FlatEndpoint<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
  Ret,
  Status extends number | undefined,
  Err extends ErrorsOption | undefined,
> = DuxEndpoint<V, P, Ret, '/', 'post', Status, Err, object>

// ── the method-map form ───────────────────────────────────────────────────────
// One contract per method on an unsuffixed file. Params are route-wide (outer);
// query/body/headers/response stay per method. Per-method validate (`V`), status,
// and errors are inferred exactly as a verb's; per-method response inference rides
// a `const` response record so inline literals survive (mirrors upstream).

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
 * declared method keys, so only declared methods enter the kernel brand.
 */
interface MethodMapDef<
  P extends SchemaWithJSON | undefined,
  Bindings,
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
  /** Route-level middleware (run for every method). Typed bindings come from the factory `.use()`. */
  middleware?: Middleware[]
  /** Default validation-error hook for every method; a method's own overrides it. */
  onValidationError?: OnValidationError
  get?: MethodDef<Get, P, 'get', GetRet, GetS, GetE, Bindings>
  post?: MethodDef<Post, P, 'post', PostRet, PostS, PostE, Bindings>
  put?: MethodDef<Put, P, 'put', PutRet, PutS, PutE, Bindings>
  patch?: MethodDef<Patch, P, 'patch', PatchRet, PatchS, PatchE, Bindings>
  delete?: MethodDef<Del, P, 'delete', DelRet, DelS, DelE, Bindings>
  head?: MethodDef<Head, P, 'head', HeadRet, HeadS, HeadE, Bindings>
  options?: MethodDef<Options, P, 'options', OptionsRet, OptionsS, OptionsE, Bindings>
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
  [M in CallableMethod as M extends K ? M : never]: DuxEndpoint<
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

// ── the definer (shared by `defineFileRoute` and a factory's call) ────────────

/**
 * The callable surface of `defineFileRoute` and every factory: the flat form
 * (tried first — it requires `handler`) and the method-map form (no top-level
 * `handler`, distinct contracts per method). `Bindings` are the capabilities the
 * factory's middleware already published; the handlers read them as `event.bindings`.
 */
export interface FileRouteDefiner<Bindings = object> {
  // Flat: one handler; the filename owns the method.
  <
    P extends SchemaWithJSON | undefined = undefined,
    V extends AnyMethodValidate = MethodValidate,
    Ret = InferMethodResponse<V>,
    const Status extends number | undefined = undefined,
    Err extends ErrorsOption | undefined = undefined,
    const Mw extends readonly Middleware[] = [],
    const Req extends readonly TypedMiddleware<any, any>[] = [],
  >(
    def: FlatDef<V, P, Ret, Status, Err, Bindings, Mw, Req>,
  ): DuxFileHandler<FlatEndpoint<V, P, Ret, Status, Err>, never>

  // Method map: distinct contracts per method on an unsuffixed file.
  <
    K extends string = never,
    P extends SchemaWithJSON | undefined = undefined,
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
    def: MethodMapDef<
      P,
      Bindings,
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
    > & Record<K, unknown>,
  ): DuxFileHandler<never, MethodMapEndpoints<
    K,
    P,
    MethodValidates<Get, Post, Put, Patch, Del, Head, Options>,
    MethodRets<GetRet, PostRet, PutRet, PatchRet, DelRet, HeadRet, OptionsRet>,
    MethodStatuses<GetS, PostS, PutS, PatchS, DelS, HeadS, OptionsS>,
    MethodErrs<GetE, PostE, PutE, PatchE, DelE, HeadE, OptionsE>
  >>
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
   * parent already runs is not registered again.
   */
  compose: <FB, FR>(
    feature: FileRouteFactory<FB, FR> & ComposeSatisfied<FR, Bindings>,
  ) => FileRouteFactory<Prettify<Bindings & FB>, Requires>
}

/** Guard `.compose(feature)`: the feature's requirements must be met by this factory's bindings. */
type ComposeSatisfied<Requires, Bindings> = [UnsatisfiedKeys<Requires, Bindings>] extends [never]
  ? unknown
  : { '⚠ compose is missing a required binding the feature depends on': UnsatisfiedKeys<Requires, Bindings> }

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
  meta?: H3RouteMeta
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
  validate?: AnyMethodValidate & { eager?: boolean }
  handler: (event: H3Event) => unknown
}

const CALLABLE: readonly CallableMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
/** Methods a flat handler is registered under; HEAD is served by upstream's auto-HEAD. */
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

/** A loose call to upstream's heavily-generic `defineRouteHandler` from a runtime-built def. */
type DefineUpstream = (def: Record<string, unknown>, options?: unknown) => EventHandlerWithFetch & Record<string, unknown>

/** Build the runtime handler for a file-route def, prepending the factory's middleware. */
function buildFileHandler(def: RuntimeDef, factoryMiddleware: readonly Middleware[]): DuxFileHandler {
  const routeMiddleware = (def.middleware ?? []).map(toMiddleware)
  const middleware = [...factoryMiddleware, ...routeMiddleware]
  const upstreamDef: Record<string, unknown> = {
    params: def.params,
    meta: def.meta,
    onValidationError: def.onValidationError,
  }

  const mapped = CALLABLE.filter(method => isObject(def[method]))
  const form: 'flat' | 'methods' = mapped.length > 0 ? 'methods' : 'flat'
  if (mapped.length > 0) {
    for (const method of mapped) {
      const md = def[method] as RuntimeMethod
      upstreamDef[method] = buildMethod(method, {
        status: md.status,
        onValidationError: md.onValidationError ?? def.onValidationError,
        errors: md.errors,
        validate: md.validate,
        handler: md.handler,
      })
    }
  }
  else if (def.handler) {
    // Flat: the same handler serves every method (the filename narrows which arrive).
    for (const method of FLAT_METHODS) {
      upstreamDef[method] = buildMethod(method, {
        status: def.status,
        onValidationError: def.onValidationError,
        errors: def.errors,
        validate: def.validate,
        handler: def.handler,
      })
    }
  }

  const inner = (defineRouteHandler as unknown as DefineUpstream)(upstreamDef, { errors: false })
  const handler = middleware.length > 0
    ? defineHandler({ handler: (event: H3Event) => runMiddleware(event, middleware, inner) })
    : inner

  return Object.assign(handler, {
    '~duxFile': true as const,
    // Runtime markers the Nitro codegen reads (the `~duxFlat`/`~duxMethods` brands
    // are type-only and absent at runtime): the authoring form, and — for a method
    // map — which methods were declared (so it can spot an unreachable-method file).
    '~duxForm': form,
    '~duxDeclared': form === 'methods' ? mapped : [],
    '~duxFlatHasBody': form === 'flat' && !!def.validate?.body,
    '~routeDef': inner['~routeDef'],
    '~options': inner['~options'],
  }) as unknown as DuxFileHandler
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
