import type { H3Config, H3Plugin } from 'h3'

import type { OnValidationError, Prettify, SchemaWithJSON } from './internal/schema-types.ts'
import type { AnyMethodValidate, MethodValidate, ResponseRecord, RouteHandlerInput, RouteHandlerOptions, RoutePlugin, RouteRecord } from './route.ts'
import type { InferRouteTypes, MergePair } from './routes.ts'
import { H3 } from 'h3'
import {

  defineRouteHandler,
  mountRouteHandler,
} from './route.ts'
/** {@link H3} config plus the h3-dux validation-error cascade root. */
export interface H3DuxAppConfig extends H3Config {
  /**
   * Default validation-error hook for every route added via `.route()`; a route's or method's own
   * `onError` overrides it. Named apart from h3's catch-all `onError` (which it leaves untouched).
   */
  onValidationError?: OnValidationError
}

/**
 * The owned h3-dux route accumulator. It is intentionally small: native h3 for
 * transport, plus `.route()` / `.register()` type accumulation for the contract
 * that `createClient` reads.
 *
 * @example
 * const app = new H3DuxApp()
 *   .route({ route: "/users/:id", get: { validate: { response: User }, handler } })
 *   .register(postsPlugin);
 *
 * type Routes = InferRoutes<typeof app>;
 */
export class H3DuxApp<Routes = object> extends H3 {
  readonly #onValidationError?: OnValidationError

  /**
   * Create the native h3 app. `onValidationError` is the app-level default for
   * every route added through h3-dux; route and method hooks can still narrow it.
   */
  constructor(config: H3DuxAppConfig = {}) {
    const { onValidationError, ...h3Config } = config
    super(h3Config)
    this.#onValidationError = onValidationError
  }

  /**
   * Register an h3 plugin and return the app for chaining. A {@link RoutePlugin} (from `defineRoute`)
   * also records its routes in the app's type, so `InferRoutes<typeof app>` includes them — the same as
   * adding them with `.route()`. Any other `H3Plugin` behaves as in base h3.
   *
   * @example app.register(defineRoute({ route: "/health", get: { handler: () => "ok" } }))
   */
  override register<P extends RoutePlugin>(
    plugin: P
  ): H3DuxApp<Prettify<MergePair<Routes, InferRouteTypes<P>>>>
  override register(plugin: H3Plugin): this
  override register(plugin: H3Plugin): this {
    super.register(plugin)
    return this
  }

  /**
   * Define and mount a route, returning the app for chaining. Pass the route path plus one entry per
   * HTTP method; each `handler`'s `event` is typed from that method's `validate` and the route
   * `params`. Different methods added to the same path (here or via `.register`) compose; a repeated
   * method keeps the first. The route is recorded in the app's type for `InferRoutes<typeof app>`.
   *
   * @example
   * app.route({
   *   route: "/users/:id",
   *   params: z.object({ id: z.coerce.number() }),
   *   get: { validate: { response: User }, handler: (e) => getUser(e.context.params.id) },
   * })
   */
  route<
    R extends string,
    K extends string = never,
    P extends SchemaWithJSON | undefined = undefined,
    Get extends AnyMethodValidate = MethodValidate,
    Put extends AnyMethodValidate = MethodValidate,
    Post extends AnyMethodValidate = MethodValidate,
    Del extends AnyMethodValidate = MethodValidate,
    Options extends AnyMethodValidate = MethodValidate,
    Head extends AnyMethodValidate = MethodValidate,
    Patch extends AnyMethodValidate = MethodValidate,
    Trace extends AnyMethodValidate = MethodValidate,
    Connect extends AnyMethodValidate = MethodValidate,
    const RR extends ResponseRecord<Get, Put, Post, Del, Options, Head, Patch, Trace, Connect> = ResponseRecord<Get, Put, Post, Del, Options, Head, Patch, Trace, Connect>,
  >(
    def: RouteHandlerInput<P, Get, Put, Post, Del, Options, Head, Patch, Trace, Connect, RR> & {
      route: R
    } & Record<K, unknown>,
    options: RouteHandlerOptions = {},
  ): H3DuxApp<
    Prettify<
      MergePair<
        Routes,
        RouteRecord<R, K, P, Get, Put, Post, Del, Options, Head, Patch, Trace, Connect>
      >
    >
  > {
    const { route, ...rest } = def
    const handler = defineRouteHandler(
      { ...rest, onValidationError: rest.onValidationError ?? this.#onValidationError },
      options,
    )
    mountRouteHandler(this, route, handler)
    return this
  }
}
