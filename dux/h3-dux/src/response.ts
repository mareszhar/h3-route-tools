import type { ResponseKind } from './internal/contract.ts'

/**
 * Response-kind primitives (delta 10). The common case is inferred: strings are
 * text, bytes/Blob/streams are binary, empty values are empty, and everything
 * else is JSON. `text()`/`binary()` remain explicit contract overrides for an
 * ambiguous schema; `typedResponse()` creates a real native `Response` whose
 * body contract remains visible to the derived client.
 */

/** Runtime + type marker keys, parallel to `sse()`'s `EventStream` brand. */
const TEXT_BRAND = '~h3dux/text'
const BINARY_BRAND = '~h3dux/binary'
const KIND_PARAMETER = 'dux-kind'

/** Brands a response as `text/plain` — the client receives a `string`. */
export interface TextResponse {
  readonly '~h3dux/text': true
}

/** Brands a response as binary (`application/octet-stream`) — the client receives a `Blob`. */
export interface BinaryResponse {
  readonly '~h3dux/binary': true
}

/** Phantom body contract carried by a native Response created with `typedResponse()`. */
export interface TypedNativeResponse<Data, Kind extends ResponseKind> extends Response {
  readonly '~h3dux/typedResponse': { data: Data, kind: Kind }
}

/**
 * A native Response with one kind-aware addition: `parse()` returns the endpoint's
 * inferred body whatever its wire representation. Standard `.json()`, `.text()`,
 * and `.blob()` remain available; only `.json()` is narrowed when JSON is honest.
 */
export type H3DuxRawResponse<Data, Kind extends ResponseKind> = Omit<Response, 'clone' | 'json'> & {
  parse: () => Promise<Data>
  json: () => Promise<Kind extends 'json' ? Data : unknown>
  clone: () => H3DuxRawResponse<Data, Kind>
}

/** Values the native Response constructor accepts as a binary body. */
export type BinaryBody = Blob | ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>

/** Infer the client-visible kind of a value passed to `typedResponse()`. */
export type ResponseKindOf<T> = [T] extends [null | undefined | void]
  ? 'empty'
  : [T] extends [string]
      ? 'text'
      : [T] extends [BinaryBody]
          ? 'binary'
          : 'json'

/** Infer the value returned by the client's all-purpose parser. */
export type ResponseDataOf<T> = ResponseKindOf<T> extends 'binary'
  ? Blob
  : ResponseKindOf<T> extends 'empty'
    ? undefined
    : T

/**
 * Mark a method's response as plain text: the handler returns a `string`, the
 * server sends it as `text/plain`, and the client receives a `string` (never
 * re-parsed as JSON). Place it where a schema would go: `validate: { response: text() }`.
 */
export function text(): TextResponse {
  return { [TEXT_BRAND]: true } as TextResponse
}

/**
 * Mark a method's response as binary: the handler returns a `Blob`/stream/bytes,
 * the server sends `application/octet-stream` (unless the body sets its own type),
 * and the client receives a `Blob`. Use it for downloads: `validate: { response: binary() }`.
 */
export function binary(): BinaryResponse {
  return { [BINARY_BRAND]: true } as BinaryResponse
}

/**
 * Construct a native web `Response` while retaining its body type end-to-end.
 *
 * - strings become text;
 * - Blob/bytes/streams become binary (`Blob` on the client);
 * - `null`/`undefined` become empty;
 * - objects and other values become JSON.
 *
 * The returned value is still an actual `Response`, so it remains compatible
 * with h3 and every web-standard consumer.
 */
export function typedResponse(): TypedNativeResponse<undefined, 'empty'>
export function typedResponse<const T>(
  data: T,
  init?: ResponseInit,
): TypedNativeResponse<ResponseDataOf<T>, ResponseKindOf<T>>
export function typedResponse<const T>(
  data?: T,
  init: ResponseInit = {},
): TypedNativeResponse<ResponseDataOf<T>, ResponseKindOf<T>> {
  const kind = runtimeResponseKind(data)
  const status = kind === 'empty' && init.status === undefined ? 204 : init.status
  const headers = new Headers(init.headers)
  if (kind === 'binary' && data instanceof Blob && data.type && !headers.has('content-type'))
    headers.set('content-type', data.type)
  if (kind !== 'empty' || (status !== 204 && status !== 205))
    setResponseKind(headers, kind)

  let body: BodyInit | null
  if (kind === 'empty') {
    body = null
  }
  else if (kind === 'json') {
    body = JSON.stringify(data)
  }
  else {
    body = data as BodyInit
  }

  return new Response(body, { ...init, status, headers }) as TypedNativeResponse<ResponseDataOf<T>, ResponseKindOf<T>>
}

/** Runtime check: was this response produced by `text()`? */
export function isTextResponse(value: unknown): boolean {
  return typeof value === 'object' && value !== null && TEXT_BRAND in value
}

/** Runtime check: was this response produced by `binary()`? */
export function isBinaryResponse(value: unknown): boolean {
  return typeof value === 'object' && value !== null && BINARY_BRAND in value
}

/** Runtime inference used by the server for the ceremony-free handler path. */
export function runtimeResponseKind(value: unknown): Exclude<ResponseKind, 'sse'> {
  if (value === null || value === undefined)
    return 'empty'
  if (typeof value === 'string')
    return 'text'
  if (
    value instanceof Blob
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
    || value instanceof ReadableStream
  ) {
    return 'binary'
  }
  return 'json'
}

/** Read dux's kind metadata without confusing it with the response MIME type. */
export function responseKindFromHeaders(headers: Headers): ResponseKind | undefined {
  const contentType = headers.get('content-type')
  if (!contentType)
    return undefined
  const match = contentType.match(/(?:^|;)\s*dux-kind=(json|text|empty|sse|binary)(?:;|$)/i)
  return match?.[1]?.toLowerCase() as ResponseKind | undefined
}

/**
 * Put the kind on the wire as a standards-valid Content-Type parameter. Unlike
 * a custom response header this remains readable through CORS, and unlike the
 * media type itself it does not turn `text/csv` into "decode as a string".
 */
export function setResponseKind(headers: Headers, kind: Exclude<ResponseKind, 'sse'>): void {
  const current = headers.get('content-type')
  const mediaType = current?.split(';', 1)[0]?.trim() || defaultMediaType(kind)
  const parameters = (current?.split(';').slice(1) ?? [])
    .map(value => value.trim())
    .filter(value => value && !value.toLowerCase().startsWith(`${KIND_PARAMETER}=`))
  parameters.push(`${KIND_PARAMETER}=${kind}`)
  headers.set('content-type', [mediaType, ...parameters].join('; '))
}

function defaultMediaType(kind: Exclude<ResponseKind, 'sse'>): string {
  if (kind === 'json')
    return 'application/json'
  if (kind === 'text')
    return 'text/plain;charset=utf-8'
  if (kind === 'binary')
    return 'application/octet-stream'
  return 'application/octet-stream'
}
