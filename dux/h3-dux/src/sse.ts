import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { ResponseKind } from './internal/contract.ts'
import type { H3DuxRawResponse } from './response.ts'
import { buildResult, H3DuxHTTPError, withParser } from './errors.ts'

/** Runtime + type marker key branding a response schema as a typed SSE stream. */
const BRAND = '~h3dux/eventStream'

/** Brands a response schema as the element type `T` of a typed `text/event-stream`. */
export interface EventStream<T> {
  readonly '~h3dux/eventStream': T
}

/**
 * Mark a response schema as a Server-Sent Events stream: the server handler
 * yields validated `T`s (an async generator), and the client receives an
 * `AsyncGenerator<T>` instead of a JSON body. See docs/dux-spec.md §4.
 */
export function sse<S extends StandardSchemaV1>(
  schema: S,
): S & EventStream<StandardSchemaV1.InferOutput<S>> {
  // Carry the schema's `~standard` validator unchanged; add a runtime brand so
  // the server can detect the SSE response and the client can be typed for it.
  return { ...schema, [BRAND]: true } as S & EventStream<StandardSchemaV1.InferOutput<S>>
}

/** Runtime check: was this response schema produced by `sse()`? */
export function isEventStream(value: unknown): boolean {
  return typeof value === 'object' && value !== null && BRAND in value
}

/** Matches an SSE event boundary — a blank line in any of the three line-ending styles. */
const FRAME_BOUNDARY = /(?:\r\n|\r|\n){2}/

/**
 * Parse one SSE frame's fields into its data payload, per the EventSource spec:
 * `data:` lines accumulate (joined with `\n`), one leading space after the colon
 * is stripped, and comment (`:…`), `id:`, `event:`, and `retry:` lines are ignored.
 * Returns `undefined` for a frame with no data (a heartbeat/comment) so it's skipped.
 */
function parseFrame<T>(frame: string): T | undefined {
  const dataLines: string[] = []
  for (const line of frame.split(/\r\n|\r|\n/)) {
    if (line === '' || line.startsWith(':'))
      continue
    const colon = line.indexOf(':')
    if ((colon === -1 ? line : line.slice(0, colon)) !== 'data')
      continue
    const value = colon === -1 ? '' : line.slice(colon + 1)
    dataLines.push(value.startsWith(' ') ? value.slice(1) : value)
  }
  return dataLines.length === 0 ? undefined : (JSON.parse(dataLines.join('\n')) as T)
}

/**
 * Parse a `text/event-stream` response body into typed events. Hardened (delta 10):
 * it refuses a non-2xx response (throwing a {@link H3DuxHTTPError}), handles `\n`,
 * `\r\n`, and `\r` line endings, accumulates multi-line `data:` payloads, ignores
 * comments and `id`/`event`/`retry` lines, and flushes a final unterminated frame.
 */
export async function* parseEventStream<T>(response: Response): AsyncGenerator<T> {
  if (!response.ok)
    throw new H3DuxHTTPError(response.status, undefined, response)
  const body = response.body
  if (!body)
    return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done)
        break
      buffer += decoder.decode(value, { stream: true })
      let match = FRAME_BOUNDARY.exec(buffer)
      while (match) {
        const event = parseFrame<T>(buffer.slice(0, match.index))
        buffer = buffer.slice(match.index + match[0].length)
        if (event !== undefined)
          yield event
        match = FRAME_BOUNDARY.exec(buffer)
      }
    }
    buffer += decoder.decode()
    // A trailing frame with no terminating blank line still carries an event.
    const tail = parseFrame<T>(buffer)
    if (tail !== undefined)
      yield tail
  }
  finally {
    reader.releaseLock()
  }
}

/**
 * The lazy handle every verb call returns (delta 8). One mechanism, four ways to
 * consume it — the type decides which is valid, and only the consumed path fetches:
 *  - `await call` → the honest result `{ data, error }` (`Result`);
 *  - `await call.orThrow()` → `Data`, rejecting with a `H3DuxError` on failure;
 *  - `await call.raw()` → the native kind-aware Response (never throws on non-2xx);
 *  - `for await (… of call)` → a typed SSE `AsyncGenerator`.
 */
export class H3DuxCall<Result, Data, Kind extends ResponseKind> implements PromiseLike<Result> {
  readonly #fetch: () => Promise<Response>
  readonly #stream: () => AsyncGenerator<unknown>
  #response?: Promise<Response>

  constructor(fetchResponse: () => Promise<Response>, stream: () => AsyncGenerator<unknown>) {
    this.#fetch = fetchResponse
    this.#stream = stream
  }

  #getResponse(): Promise<Response> {
    return (this.#response ??= this.#fetch())
  }

  async #cloneResponse(): Promise<Response> {
    return (await this.#getResponse()).clone()
  }

  /** Default `await`: the honest `{ data, error }` result. */
  then<R1 = Result, R2 = never>(
    onFulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return (buildResult(() => this.#cloneResponse()) as Promise<Result>).then(onFulfilled, onRejected)
  }

  /** Bubble the error instead of returning it — for scripts, SSR loaders, server-to-server. */
  orThrow(): Promise<Data> {
    return buildResult(() => this.#cloneResponse()).then((result) => {
      if (result.error)
        throw result.error
      return result.data as Data
    })
  }

  /** The web-standard escape hatch: the native response, never throwing on a non-2xx status. */
  async raw(): Promise<H3DuxRawResponse<Data, Kind>> {
    return withParser<Data, Kind>(await this.#cloneResponse())
  }

  [Symbol.asyncIterator](): AsyncGenerator<unknown> {
    return this.#stream()
  }
}
