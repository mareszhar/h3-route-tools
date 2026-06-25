/**
 * The contract kernel (delta 7, completed in phase 9): the normalized, schema-free
 * shape every plane reads. `DuxEndpoint` (internal/route-types.ts) now *is* the
 * kernel — `{ request, responses, success }`, computed once at accumulation time —
 * and both `createServer`'s `typeof app` and Nitro's generated `#h3-dux/routes`
 * produce it. This module projects that kernel into what the *client* consumes:
 * `data` (success body by kind), the typed `error` (per-status `responses`), and
 * the `{ data, error }` result.
 *
 * The kernel is a projection, not a replacement: runtime validation still runs
 * off the original schema, so there is one source of truth.
 */
import type { DuxError } from '../errors.ts'
import type { EventStream } from '../sse.ts'
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
 * The projections below read an endpoint's **contract kernel** (`{ request,
 * responses, success }`) — itself already resolved, schema-free shapes. Each is a
 * conditional/inference that resolves in display, so the verb's return type prints
 * plain values (`Fruit`, `{ 409: … }`), never the kernel alias or schema generics.
 */

/** The kernel's success entry (`{ body, kind }` at the `success` status). */
type SuccessEntry<E> = E extends { success: infer S, responses: infer R }
  ? S extends keyof R ? R[S] : never
  : never

/** The response *kind* the endpoint answers with — the client decodes `data` by it. */
export type SuccessKindOf<E> = SuccessEntry<E> extends { kind: infer K extends ResponseKind } ? K : 'json'

/**
 * The success value a call yields, decoded by the endpoint's response *kind*
 * (delta 10) — so the client never guesses `.json()` on a body that has none:
 *  - `text`   → `string`            (a `text/plain` body)
 *  - `binary` → `Blob`             (a download)
 *  - `empty`  → `undefined`        (`204`/no body)
 *  - `sse`    → `AsyncGenerator<T>` (a stream — consumed with `for await`)
 *  - `json`   → the serialized wire shape (the default)
 * A native `Response` returned by a handler is opaque to the contract, so its
 * data is `unknown` — reach for `.raw()` to inspect it.
 */
export type ClientData<E> = SuccessEntry<E> extends { body: infer B, kind: infer K }
  ? ResponseBody<K, B>
  : unknown

type ResponseBody<K, R>
  = K extends 'text' ? string
    : K extends 'binary' ? Blob
      : K extends 'empty' ? undefined
        : K extends 'sse' ? (R extends EventStream<infer T> ? AsyncGenerator<T> : AsyncGenerator<unknown>)
          : R extends Response ? unknown
            : Serialize<R>

/**
 * An endpoint's error map (`{ status: body }`), projected from the kernel's
 * `responses` — every status except the success one. The homomorphic mapped type
 * forces resolution, so the client's typed `error` prints `{ 409: … }`.
 */
export type ClientErrors<E> = E extends { success: infer S, responses: infer R }
  ? { [Status in keyof R as Status extends S ? never : Status]: R[Status] extends { body: infer B } ? B : never }
  : object

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
