import type { ResponseKind } from './internal/contract.ts'
import type { DuxRawResponse } from './response.ts'
import { responseKindFromHeaders } from './response.ts'

/**
 * The honest client's failure channel (delta 8/9). A call resolves to a result
 * `{ data, error }`; `error` is a `DuxError` — either a typed non-2xx response
 * (`DuxHTTPError`) or a request that never completed (`DuxTransportError`). The
 * `.orThrow()` opt-out rejects with the same instances.
 */

/** A non-2xx HTTP response. `data` is the parsed error body — typed per status from the contract. */
export class DuxHTTPError<Data = unknown> extends Error {
  readonly kind = 'http' as const
  constructor(
    readonly status: number,
    readonly data: Data,
    readonly response: Response,
  ) {
    super(`Request failed with status ${status}`)
    this.name = 'DuxHTTPError'
  }
}

/** The request never reached a response — network down, DNS, CORS, aborted. */
export class DuxTransportError extends Error {
  readonly kind = 'transport' as const
  constructor(cause: unknown) {
    super('Request did not complete', { cause })
    this.name = 'DuxTransportError'
  }
}

/** Either failure a client call can surface. */
export type DuxError<Data = unknown> = DuxHTTPError<Data> | DuxTransportError

/** The neutral result shape, before the contract narrows `data`/`error`. */
export type RawResult = { data: unknown, error: undefined } | { data: undefined, error: DuxError }

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
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? ''
    return new Blob([await response.arrayBuffer()], { type: mediaType })
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
): DuxRawResponse<Data, Kind> {
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
  return response as DuxRawResponse<Data, Kind>
}

/**
 * Run a fetch and fold it into the honest result. A non-2xx becomes a
 * `DuxHTTPError` (not a throw); a fetch that rejects becomes a
 * `DuxTransportError`. Only the body is read — once.
 */
export async function buildResult(fetchResponse: () => Promise<Response>): Promise<RawResult> {
  let response: Response
  try {
    response = await fetchResponse()
  }
  catch (cause) {
    return { data: undefined, error: new DuxTransportError(cause) }
  }
  const body = await parseBody(response)
  if (response.ok)
    return { data: body, error: undefined }
  return { data: undefined, error: new DuxHTTPError(response.status, unwrapErrorData(body), response) }
}
