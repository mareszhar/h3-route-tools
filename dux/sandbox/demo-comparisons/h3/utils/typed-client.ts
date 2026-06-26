import type {
  CheckoutOrder,
  ErrorBody,
  Fruit,
  FruitPage,
  FruitPatch,
  FruitQuery,
  HealthReport,
  NewFruit,
  Receipt,
  RipenTick,
} from '@orchard/domain'
import { ORCHARD_KEY, ORCHARD_KEY_HEADER } from '@orchard/domain'

/** A web-standard request handler — global `fetch`, or an app's in-process `fetch`. */
export type Fetcher = (request: Request) => Response | Promise<Response>

export type Result<T>
  = | { ok: true, status: number, data: T }
    | { ok: false, status: number, error: ErrorBody }

export interface OrchardClientOptions {
  /** Absolute origin to resolve paths against. */
  baseUrl?: string
  /** Write key sent on mutating requests. */
  key?: string
  /** Fetch implementation (defaults to global fetch). */
  fetch?: Fetcher
}

/**
 * A tiny end-to-end typed Orchard client built on web-standard fetch and the
 * shared valibot-inferred types. h3 ships no RPC client, so this extra typed-
 * client step is its idiomatic story — and the h3 + Nitro-h3 demos both reuse it.
 */
export function createOrchardClient(options: OrchardClientOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://orchard.local'
  const key = options.key ?? ORCHARD_KEY
  const call: Fetcher = options.fetch ?? globalThis.fetch

  async function request<T>(
    method: string,
    path: string,
    init: { query?: FruitQuery, body?: unknown, auth?: boolean } = {},
  ): Promise<Result<T>> {
    const url = new URL(path, baseUrl)
    for (const [k, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== '')
        url.searchParams.set(k, String(value))
    }

    const headers: Record<string, string> = {}
    if (init.auth)
      headers[ORCHARD_KEY_HEADER] = key
    if (init.body !== undefined)
      headers['content-type'] = 'application/json'

    const res = await call(
      new Request(url, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    )

    if (res.status === 204)
      return { ok: true, status: 204, data: null as T }

    const payload = await res.json().catch(() => null)
    return res.ok
      ? { ok: true, status: res.status, data: payload as T }
      : {
          ok: false,
          status: res.status,
          error: (payload ?? { error: 'error', message: res.statusText }) as ErrorBody,
        }
  }

  return {
    health: () => request<HealthReport>('GET', '/health'),
    listFruits: (query: FruitQuery = {}) => request<FruitPage>('GET', '/fruits', { query }),
    getFruit: (id: string) => request<Fruit>('GET', `/fruits/${id}`),
    createFruit: (body: NewFruit) => request<Fruit>('POST', '/fruits', { body, auth: true }),
    updateFruit: (id: string, patch: FruitPatch) =>
      request<Fruit>('PATCH', `/fruits/${id}`, { body: patch, auth: true }),
    removeFruit: (id: string) => request<null>('DELETE', `/fruits/${id}`, { auth: true }),
    checkout: (order: CheckoutOrder) => request<Receipt>('POST', '/checkout', { body: order }),

    /** Consume the SSE ripeness stream as typed ticks. */
    async* ripen(id: string): AsyncGenerator<RipenTick> {
      const res = await call(
        new Request(new URL(`/fruits/${id}/ripen`, baseUrl), {
          headers: { accept: 'text/event-stream' },
        }),
      )
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done)
          break
        buffer += decoder.decode(value, { stream: true })

        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const data = buffer
            .slice(0, boundary)
            .split('\n')
            .find(line => line.startsWith('data:'))
          buffer = buffer.slice(boundary + 2)
          if (data)
            yield JSON.parse(data.slice(5).trim()) as RipenTick
          boundary = buffer.indexOf('\n\n')
        }
      }
    },
  }
}

/** The shape returned by {@link createOrchardClient}. */
export type OrchardClient = ReturnType<typeof createOrchardClient>
