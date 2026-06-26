import type { ResponseKind } from './internal/contract.ts'
import type { H3DuxRawResponse } from './response.ts'
import { responseKindFromHeaders } from './response.ts'

/**
 * The honest client's failure channel (delta 8/9). A call resolves to a result
 * `{ data, error }`; `error` is a `H3DuxError` — either a typed non-2xx response
 * (`H3DuxHTTPError`) or a request that never completed (`H3DuxTransportError`). The
 * `.orThrow()` opt-out rejects with the same instances.
 */

/**
 * A non-2xx HTTP response. `data` is the parsed error body — typed per status from
 * the contract. `Status` is the literal status code, so a `error.status === 409`
 * check narrows a union of these to the matching body (delta 9); it widens to
 * `number`/`unknown` when the endpoint declares no errors.
 */
export class H3DuxHTTPError<Status extends number = number, Data = unknown> extends Error {
  readonly kind = 'http' as const
  constructor(
    readonly status: Status,
    readonly data: Data,
    readonly response: Response,
  ) {
    super(`Request failed with status ${status}`)
    this.name = 'H3DuxHTTPError'
  }
}

/** The request never reached a response — network down, DNS, CORS, aborted. */
export class H3DuxTransportError extends Error {
  readonly kind = 'transport' as const
  /**
   * A transport failure has no HTTP status — it is `undefined`, exactly as the
   * runtime returns. Declaring it makes `status` a shared discriminant across the
   * whole error union, so the natural `if (error?.status === 409)` narrows straight
   * to that `H3DuxHTTPError` without a separate `kind` guard first (Elysia-Treaty
   * ergonomics), while transport stays *in* the union — honest, not hidden behind a
   * throw. `declare` adds it to the type only; no field is emitted.
   */
  declare readonly status: undefined
  constructor(cause: unknown) {
    super('Request did not complete', { cause })
    this.name = 'H3DuxTransportError'
  }
}

/** Either failure a client call can surface. */
export type H3DuxError<Data = unknown> = H3DuxHTTPError<number, Data> | H3DuxTransportError

/** The neutral result shape, before the contract narrows `data`/`error`. */
export type RawResult = { data: unknown, error: undefined } | { data: undefined, error: H3DuxError }

/**
 * Recover the declared error payload from an h3 error response. h3 serializes a
 * thrown `HTTPError` as `{ status, message, data }`, where `data` is exactly what
 * the handler declared (via `errors`/`event.error`, or the `{ source, issues }`
 * validation envelope). Unwrapping it keeps `error.data` matching the contract;
 * a body that isn't an h3 envelope passes through untouched.
 */
function unwrapErrorData(body: unknown): unknown {
  if (body !== null && typeof body === 'object' && 'data' in body && ('status' in body || 'statusCode' in body))
    return (body as { data: unknown }).data
  return body
}

function mediaType(headers: Headers): string {
  return headers.get('content-type')?.split(';', 1)[0]?.trim() ?? ''
}

function withBlobType(blob: Blob, type: string): Blob {
  if (!type || blob.type === type)
    return blob
  Object.defineProperty(blob, 'type', { configurable: true, value: type })
  return blob
}

/**
 * Read a response body by dux's kind metadata — the runtime half of the response
 * contract. Kind is independent of MIME, so a `text/csv` binary response remains
 * a Blob and an empty text response remains `""`. Opaque/native responses without
 * kind metadata fall back conservatively to their MIME type.
 */
export async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205)
    return undefined

  const kind = responseKindFromHeaders(response.headers)
  if (kind === 'empty')
    return undefined
  if (kind === 'text')
    return await response.text()
  if (kind === 'binary') {
    return withBlobType(
      new Blob([await response.arrayBuffer()], { type: mediaType(response.headers) }),
      mediaType(response.headers),
    )
  }
  if (kind === 'json') {
    try {
      return await response.json()
    }
    catch {
      return undefined
    }
  }

  // Opaque/native or non-dux responses: decode conservatively from the MIME.
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (contentType === 'application/json' || contentType.endsWith('+json')) {
    try {
      return await response.json()
    }
    catch {
      return undefined
    }
  }
  if (contentType.startsWith('text/'))
    return await response.text()
  if (contentType)
    return await response.blob()
  // No content type: best-effort for opaque/native responses only.
  const text = await response.text()
  if (!text)
    return undefined
  try {
    return JSON.parse(text)
  }
  catch {
    return text
  }
}

/** Add the kind-aware `.parse()` method while preserving a genuine Response. */
export function withParser<Data, Kind extends ResponseKind>(
  response: Response,
): H3DuxRawResponse<Data, Kind> {
  const nativeClone = response.clone.bind(response)
  Object.defineProperties(response, {
    parse: {
      configurable: true,
      value: () => parseBody(response) as Promise<Data>,
    },
    clone: {
      configurable: true,
      value: () => withParser<Data, Kind>(nativeClone()),
    },
  })
  return response as H3DuxRawResponse<Data, Kind>
}

/**
 * Run a fetch and fold it into the honest result. A non-2xx becomes a
 * `H3DuxHTTPError` (not a throw); a fetch that rejects becomes a
 * `H3DuxTransportError`. Only the body is read — once.
 */
export async function buildResult(fetchResponse: () => Promise<Response>): Promise<RawResult> {
  let response: Response
  try {
    response = await fetchResponse()
  }
  catch (cause) {
    return { data: undefined, error: new H3DuxTransportError(cause) }
  }
  const body = await parseBody(response)
  if (response.ok)
    return { data: body, error: undefined }
  return { data: undefined, error: new H3DuxHTTPError(response.status, unwrapErrorData(body), response) }
}
