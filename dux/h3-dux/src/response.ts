/**
 * Response-kind markers (delta 10). Not every response is JSON: a `text/plain`
 * body or a download decodes differently, and the client shouldn't have to guess
 * `.json()`. `text()` and `binary()` brand a method's `validate.response` the way
 * `sse()` does — they declare the response *kind* so the contract carries it, the
 * server sends the right content-type, and the client returns `string`/`Blob`
 * instead of a parsed object. See docs/dux-conventions.md §11.
 *
 * `sse()` lives in `sse.ts` (it carries a schema and the streaming machinery);
 * these two are the schema-free siblings — a string and a blob need no validator.
 */

/** Runtime + type marker keys, parallel to `sse()`'s `EventStream` brand. */
const TEXT_BRAND = '~h3dux/text'
const BINARY_BRAND = '~h3dux/binary'

/** Brands a response as `text/plain` — the client receives a `string`. */
export interface TextResponse {
  readonly '~h3dux/text': true
}

/** Brands a response as binary (`application/octet-stream`) — the client receives a `Blob`. */
export interface BinaryResponse {
  readonly '~h3dux/binary': true
}

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

/** Runtime check: was this response produced by `text()`? */
export function isTextResponse(value: unknown): boolean {
  return typeof value === 'object' && value !== null && TEXT_BRAND in value
}

/** Runtime check: was this response produced by `binary()`? */
export function isBinaryResponse(value: unknown): boolean {
  return typeof value === 'object' && value !== null && BINARY_BRAND in value
}
