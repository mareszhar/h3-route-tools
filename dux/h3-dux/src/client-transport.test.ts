import type { App } from '@test'
import { createClient } from '@mszr/h3-dux'
import { expect, it } from 'vitest'

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; dux-kind=json')
  return new Response(JSON.stringify(data), { ...init, headers })
}

it('a H3DuxCall shares one in-flight request across await/orThrow/raw', async () => {
  let calls = 0
  const api = createClient<App>({
    fetch: () => {
      calls++
      return json({ status: 'ripe', at: 'now' })
    },
  })

  const call = api.get('/health')
  const [result, data, raw] = await Promise.all([
    call,
    call.orThrow(),
    call.raw(),
  ])

  expect(calls).toBe(1)
  expect(result.data?.status).toBe('ripe')
  expect(data.status).toBe('ripe')
  expect(await raw.parse()).toEqual({ status: 'ripe', at: 'now' })
})

it('runs hooks, serializes repeated query values, and retries retryable responses', async () => {
  const urls: string[] = []
  const authHeaders: string[] = []
  const seen: string[] = []
  let calls = 0

  const api = createClient<App>({
    retry: { attempts: 1, statuses: [503] },
    querySerializer: 'repeat',
    onRequest(ctx) {
      ctx.request.headers.set('authorization', 'Bearer token')
      seen.push(`request:${ctx.attempt}`)
    },
    onResponse(ctx) {
      seen.push(`response:${ctx.response.status}`)
    },
    onResponseError(ctx) {
      seen.push(`http:${ctx.response.status}`)
    },
    fetch: (url, init) => {
      calls++
      urls.push(url)
      authHeaders.push(new Headers(init?.headers).get('authorization') ?? '')
      return calls === 1
        ? json({ error: 'busy' }, { status: 503, headers: { 'retry-after': '0' } })
        : json({ status: 'ripe', at: 'now' })
    },
  })

  const data = await api.get('/health', {
    query: { tag: ['a', 'b'] } as never,
  }).orThrow()

  expect(data.status).toBe('ripe')
  expect(calls).toBe(2)
  expect(urls[0]).toBe('/health?tag=a&tag=b')
  expect(authHeaders).toEqual(['Bearer token', 'Bearer token'])
  expect(seen).toEqual(['request:1', 'response:503', 'http:503', 'request:2', 'response:200'])
})

it('calls onRequestError for transport failures', async () => {
  let reported: unknown
  const api = createClient<App>({
    onRequestError(ctx) {
      reported = ctx.error
    },
    fetch: () => {
      throw new Error('down')
    },
  })

  const { error } = await api.get('/health')
  expect(error?.kind).toBe('transport')
  expect(reported).toBeInstanceOf(Error)
})
