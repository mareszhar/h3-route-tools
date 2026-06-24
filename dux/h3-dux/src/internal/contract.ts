/**
 * The contract kernel (delta 7): the normalized, schema-free projection of an
 * endpoint that every plane reads. `DuxEndpoint` (internal/route-types.ts) stores
 * the resolved request shapes, the success body, and the per-status error map;
 * this module projects that into what the *client* consumes — `data`, the typed
 * `error`, and the `{ data, error }` result — and documents the kernel shape the
 * Nitro codegen and OpenAPI generators will read in later deltas.
 *
 * The kernel is a projection, not a replacement: runtime validation still runs
 * off the original schema, so there is one source of truth.
 */
import type { DuxError } from '../errors.ts'
import type { Serialize } from './serialize.ts'

/** How a response body crosses the wire. `json` is the default; the rest are delta 10. */
export type ResponseKind = 'json' | 'text' | 'empty' | 'sse' | 'binary'

/** The documented kernel shape every plane consumes (the spine of Generation 2). */
export interface EndpointContract {
  request: { params: unknown, query: unknown, headers: unknown, body: unknown }
  responses: Record<number, { body: unknown, kind: ResponseKind }>
  success: number
}

/**
 * The projections below take an endpoint's **resolved** pieces (the success body,
 * the error map) rather than the whole `DuxEndpoint`. This matters for the hover:
 * a *conditional* alias (`ClientData`) resolves in display, but a *union/object*
 * alias displays its argument unresolved — so passing the raw endpoint would leak
 * `DuxEndpoint<… ObjectSchema …>` into the verb's return type. `client.ts` indexes
 * the resolved members first, then composes them here.
 */

/** The success body a call yields as `data`, in its wire shape. */
export type ClientData<E> = E extends { response: infer R } ? Serialize<R> : unknown

/** An endpoint's error map (`{ status: body }`), resolved. */
export type ClientErrors<E> = E extends { errors: infer Errors } ? Errors : object

/**
 * The typed HTTP error for an error map: a union discriminated by `status`. With no
 * declared errors it degrades to a generic `{ status: number, data: unknown }` —
 * honesty holds everywhere, typing sharpens where the contract declares it.
 */
export type ClientHttpError<Errors> = [keyof Errors] extends [never]
  ? { kind: 'http', status: number, data: unknown, response: Response }
  : { [S in keyof Errors & number]: { kind: 'http', status: S, data: Serialize<Errors[S]>, response: Response } }[keyof Errors & number]

/** The full error channel: a typed HTTP error or a transport failure. */
export type ClientError<Errors> = ClientHttpError<Errors> | { kind: 'transport', cause: unknown }

/** What a default verb call resolves to: success → `data`, otherwise a typed `error`. */
export type HonestResult<Data, Err>
  = | { data: Data, error: undefined }
    | { data: undefined, error: Err }

/** Narrow {@link DuxError} (runtime) to the contract's error union (display/return typing). */
export type { DuxError }
