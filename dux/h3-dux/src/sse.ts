import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { TypedResponse } from 'h3-route-tools'
import { buildResult } from './errors.ts'

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

/** Parse a `text/event-stream` response body into typed events. */
export async function* parseEventStream<T>(response: Response): AsyncGenerator<T> {
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
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame.split('\n').find(line => line.startsWith('data:'))
        if (data)
          yield JSON.parse(data.slice(5).trim()) as T
        boundary = buffer.indexOf('\n\n')
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}

/**
 * The lazy handle every verb call returns (delta 8). One mechanism, four ways to
 * consume it — the type decides which is valid, and only the consumed path fetches:
 *  - `await call` → the honest result `{ data, error }` (`Result`);
 *  - `await call.orThrow()` → `Data`, rejecting with a `DuxError` on failure;
 *  - `await call.raw()` → the native `TypedResponse` (never throws on non-2xx);
 *  - `for await (… of call)` → a typed SSE `AsyncGenerator`.
 */
export class DuxCall<Result, Data> implements PromiseLike<Result> {
  readonly #fetch: () => Promise<Response>
  readonly #stream: () => AsyncGenerator<unknown>

  constructor(fetchResponse: () => Promise<Response>, stream: () => AsyncGenerator<unknown>) {
    this.#fetch = fetchResponse
    this.#stream = stream
  }

  /** Default `await`: the honest `{ data, error }` result. */
  then<R1 = Result, R2 = never>(
    onFulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return (buildResult(this.#fetch) as Promise<Result>).then(onFulfilled, onRejected)
  }

  /** Bubble the error instead of returning it — for scripts, SSR loaders, server-to-server. */
  orThrow(): Promise<Data> {
    return buildResult(this.#fetch).then((result) => {
      if (result.error)
        throw result.error
      return result.data as Data
    })
  }

  /** The web-standard escape hatch: the native response, never throwing on a non-2xx status. */
  raw(): Promise<TypedResponse<Data>> {
    return this.#fetch() as Promise<TypedResponse<Data>>
  }

  [Symbol.asyncIterator](): AsyncGenerator<unknown> {
    return this.#stream()
  }
}
