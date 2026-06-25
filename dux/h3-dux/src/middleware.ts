/**
 * Typed middleware bindings (delta 12). Middleware keeps ordinary h3 semantics —
 * it can continue, intercept, redirect, throw, or post-process — and gains one
 * optional capability: publishing request-scoped, *typed* values that downstream
 * middleware and handlers read as `event.bindings`. See docs/dux-conventions.md §13.
 *
 * `defineMiddleware(fn)` keeps the direct callback form for plain middleware;
 * `defineMiddleware({ requires?, staged?, bindings?, handler? })` adds the typed
 * capability metadata. Either way the result is a real h3 `Middleware`, so it
 * registers with `.use(...)` / `middleware: [...]` exactly like any other.
 */
import type { H3Event, Middleware } from 'h3'

/** A value or a promise of it — h3's middleware return shape, not re-exported by h3. */
type MaybePromise<T> = T | Promise<T>

/** Flatten an intersection into a plain object type (display only). */
type Prettify<T> = { [K in keyof T]: T[K] }

/** Phantom carrier for a middleware's typed metadata — never present at runtime. */
declare const META: unique symbol

/**
 * A real h3 `Middleware` that also carries, in its type only, the bindings it
 * needs from upstream and the bindings it publishes downstream. The brand
 * is required (not optional) so two providers of the same key are distinguishable
 * at the cursor; it never exists at runtime.
 */
export interface TypedMiddleware<Requires = object, Bindings = object> {
  (event: H3Event, next: () => MaybePromise<unknown>): MaybePromise<unknown>
  readonly [META]: { requires: Requires, bindings: Bindings }
}

/**
 * A plain h3 middleware accepted by `.use(...)` — explicitly *not* a branded
 * {@link TypedMiddleware} (its `[META]` is forbidden), so a colliding typed
 * provider can't slip through this overload and dodge the conflict check. Carries
 * its own call signature so `(event, next) => …` params type without annotation.
 * Contributes no bindings.
 */
export interface PlainMiddleware {
  (event: H3Event, next: () => MaybePromise<unknown>): MaybePromise<unknown>
  readonly [META]?: never
}

/** The bindings a typed middleware publishes (`object` for a plain one). */
export type BindingsOf<M> = M extends TypedMiddleware<any, infer B> ? B : object

/** Intersect the published bindings of a tuple of providers. */
export type TupleBindings<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Tail]
  ? BindingsOf<Head> & TupleBindings<Tail>
  : object

/**
 * The event a typed middleware's callbacks receive: an ordinary `H3Event` plus
 * the root accessors h3-dux installs — `bindings` (published so far), `staged`
 * (this middleware's private preparation), and the request aliases.
 */
export type BoundEvent<Bindings = object, Staged = undefined> = H3Event & {
  bindings: Bindings
  staged: Staged
  params: Record<string, string>
  query: Record<string, string | string[]>
  body: unknown
}

/**
 * The options form of `defineMiddleware`. `staged` runs first (private values),
 * then `bindings` (published downstream), then `handler` (full h3 control of
 * `next`). `requires` lists providers whose bindings must already be present; it
 * registers and runs nothing — it only types the incoming `event.bindings`.
 */
export interface MiddlewareSpec<
  Requires extends readonly TypedMiddleware<any, any>[],
  Staged,
  Bindings extends object,
> {
  /** Providers an enclosing scope must already supply — consumed, never executed. */
  requires?: Requires
  /** Private preparation, exposed as `event.staged` to this middleware only. */
  staged?: (event: BoundEvent<TupleBindings<Requires>>) => Staged | Promise<Staged>
  /** The bindings this middleware publishes — the return object *is* the contract. */
  bindings?: (event: BoundEvent<TupleBindings<Requires>, Staged>) => Bindings | Promise<Bindings>
  /** Ordinary h3 middleware, now seeing the staged values and published bindings. */
  handler?: (
    event: BoundEvent<Prettify<TupleBindings<Requires> & Bindings>, Staged>,
    next: () => Promise<unknown>,
  ) => MaybePromise<unknown>
}

/** Marker confirming the dux root accessors were installed on an event. */
const ACCESSORS = Symbol.for('h3dux.accessors')

/** Mutable view of an h3 event's context for the canonical dux storage slots. */
interface DuxContext {
  bindings?: Record<string, unknown>
  staged?: unknown
  params?: Record<string, string>
  query?: unknown
  body?: unknown
}

/**
 * Install the dux root accessors (`event.bindings/staged/params/query/body`) over
 * the canonical `event.context` storage, once per event. Idempotent: middleware
 * and the route handler both call it, and only the first one defines the getters.
 * `bindings` lazily creates its store so reading it before any provider is safe.
 */
export function ensureDuxAccessors(event: H3Event): void {
  const target = event as unknown as Record<PropertyKey, unknown>
  if (target[ACCESSORS])
    return
  Object.defineProperties(event, {
    [ACCESSORS]: { value: true },
    bindings: {
      configurable: true,
      get(this: H3Event) {
        const ctx = this.context as DuxContext
        return (ctx.bindings ??= {})
      },
    },
    staged: {
      configurable: true,
      get(this: H3Event) {
        return (this.context as DuxContext).staged
      },
    },
    params: {
      configurable: true,
      get(this: H3Event) {
        return this.context.params
      },
    },
    query: {
      configurable: true,
      get(this: H3Event) {
        return (this.context as DuxContext).query
      },
    },
    body: {
      configurable: true,
      get(this: H3Event) {
        return (this.context as DuxContext).body
      },
    },
  })
}

/**
 * Define typed middleware. Two forms, one result (a real h3 `Middleware`):
 *  - `defineMiddleware((event, next) => …)` — the smallest form, publishes nothing.
 *  - `defineMiddleware({ requires, staged, bindings, handler })` — runs `staged`
 *    then `bindings` then `handler`, exposing `event.staged`/`event.bindings`.
 */
export function defineMiddleware(fn: Middleware): TypedMiddleware<object, object>
export function defineMiddleware<
  const Requires extends readonly TypedMiddleware<any, any>[] = [],
  Staged = undefined,
  Bindings extends object = object,
>(
  spec: MiddlewareSpec<Requires, Staged, Bindings>,
): TypedMiddleware<TupleBindings<Requires>, Bindings>
export function defineMiddleware(
  input: Middleware | MiddlewareSpec<any, any, any>,
): TypedMiddleware<any, any> {
  if (typeof input === 'function')
    return input as unknown as TypedMiddleware<any, any>
  return runSpec(input) as unknown as TypedMiddleware<any, any>
}

/**
 * Build the runtime wrapper for the options form. The lifecycle is
 * `staged → bindings → handler(event, next)`; staged values are private and
 * restored to the enclosing scope while `next()` runs (so downstream code never
 * sees them), bindings are merged into the shared store and stay visible
 * downstream. `requires` is type-only and does nothing here.
 */
function runSpec(spec: MiddlewareSpec<any, any, any>): Middleware {
  const { staged, bindings, handler } = spec
  return async (event, next) => {
    ensureDuxAccessors(event)
    const ctx = event.context as DuxContext
    const enclosingStaged = ctx.staged
    ctx.staged = staged ? await staged(event as BoundEvent) : undefined
    if (bindings) {
      const published = await bindings(event as BoundEvent)
      ctx.bindings = Object.assign(ctx.bindings ?? {}, published)
    }
    // Hide this middleware's staged scope while downstream runs, then restore it
    // so any post-`next()` logic in the handler sees its own staged values again.
    const innerNext = async (): Promise<unknown> => {
      const mine = ctx.staged
      ctx.staged = enclosingStaged
      try {
        return await next()
      }
      finally {
        ctx.staged = mine
      }
    }
    try {
      return handler ? await handler(event as BoundEvent, innerNext) : await innerNext()
    }
    finally {
      ctx.staged = enclosingStaged
    }
  }
}

/** Coerce an inline options object into a wrapper; pass a function through unchanged. */
export function toMiddleware(input: Middleware | MiddlewareSpec<any, any, any>): Middleware {
  return typeof input === 'function' ? input : runSpec(input)
}

// ── type-level composition helpers (consumed by server.ts and router.ts) ──────

/** The keys two binding sets both declare — a provider collision when non-`never`. */
type Overlap<A, B> = Extract<keyof A, keyof B>

/** A cursor-legible error standing in for a colliding middleware argument. */
export interface BindingConflict<Key extends PropertyKey> {
  readonly '⚠ binding already provided by an earlier middleware': Key
}

/**
 * Guard a `.use(provider)` argument: the provider passes through unchanged unless
 * it publishes a key the chain already provides, in which case the *expected*
 * type becomes an unsatisfiable conflict brand so the error lands on the argument.
 * Two providers may not publish the same key, even if the value types agree (§13).
 */
export type NoConflict<M extends TypedMiddleware<any, any>, Existing>
  = [Overlap<BindingsOf<M>, Existing>] extends [never]
    ? M
    : TypedMiddleware<any, BindingConflict<Overlap<BindingsOf<M>, Existing>>>

/**
 * The inline `.use({ … })` form. Its callbacks see the chain's accumulated
 * bindings (`Existing`) contextually — that is the only difference from a
 * standalone {@link MiddlewareSpec}, which starts from its own `requires`.
 */
export interface InlineSpec<Existing, Staged, Bindings extends object> {
  /**
   * Excludes an already-branded {@link TypedMiddleware} from this overload, so a
   * colliding provider falls through to a cursor error instead of being swallowed.
   */
  readonly [META]?: never
  requires?: readonly TypedMiddleware<any, any>[]
  staged?: (event: BoundEvent<Existing>) => Staged | Promise<Staged>
  bindings?: (event: BoundEvent<Existing, Staged>) => Bindings | Promise<Bindings>
  handler?: (
    event: BoundEvent<Prettify<Existing & Bindings>, Staged>,
    next: () => Promise<unknown>,
  ) => MaybePromise<unknown>
}
