import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { H3TypedConfig } from 'h3-route-tools'
import { H3Typed } from 'h3-route-tools'

// ── upstream surface ─────────────────────────────────────────────────────────
// h3-dux is a superset of h3-route-tools: everything upstream exports is
// available here unchanged, so tracking upstream stays a re-export, not a rewrite.
export * from 'h3-route-tools'

// ── dux renames (counterpart-named; see docs/dux-conventions.md) ──────────────

/**
 * Create a typed h3 server. The counterpart of {@link createClient}: the server
 * you build here is the single source of truth the client is typed from
 * (`createClient<typeof app>()`). A thin factory over upstream `H3Typed`, which
 * stays exported under its own name for parity with h3-route-tools.
 */
export function createServer(config?: H3TypedConfig) {
  return new H3Typed(config)
}

/** Build a typed fetch client from a server's `typeof app`. The counterpart of {@link createServer}. */
export { createTypedFetch as createClient } from 'h3-route-tools'

// ── typed SSE (PLANNED — docs/dux-spec.md §4) ─────────────────────────────────

/** Brands a {@link StandardSchemaV1} as the element type of a typed SSE stream. */
export interface EventStream<T> {
  readonly '~h3dux/eventStream': T
}

/**
 * Mark a response schema as a Server-Sent Events stream of its validated element
 * type. It sits in `validate.response`; the server yields an async generator and
 * the client receives an `AsyncGenerator<T>` instead of a JSON body.
 *
 * PLANNED: today this is a typed pass-through — the brand exists so call sites
 * stay stable — while the client-side `AsyncGenerator` return-type derivation and
 * the server stream wiring are implemented with the SSE delta (docs/dux-spec.md §4).
 */
export function sse<S extends StandardSchemaV1>(
  schema: S,
): S & EventStream<StandardSchemaV1.InferOutput<S>> {
  return schema as S & EventStream<StandardSchemaV1.InferOutput<S>>
}
