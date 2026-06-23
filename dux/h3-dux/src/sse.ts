import type { StandardSchemaV1 } from '@standard-schema/spec'

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
 * A lazy response handle returned by the verb methods. `await` it for the JSON
 * path (resolving a `TypedResponse`); `for await` it for the SSE path (a typed
 * async iterator). The endpoint's type decides which is valid — the runtime
 * supports both, so neither path fetches until you consume it.
 */
export class DuxCall<T> implements PromiseLike<T> {
  readonly #json: () => Promise<T>
  readonly #stream: () => AsyncGenerator<unknown>

  constructor(json: () => Promise<T>, stream: () => AsyncGenerator<unknown>) {
    this.#json = json
    this.#stream = stream
  }

  then<R1 = T, R2 = never>(
    onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.#json().then(onFulfilled, onRejected)
  }

  [Symbol.asyncIterator](): AsyncGenerator<unknown> {
    return this.#stream()
  }
}
