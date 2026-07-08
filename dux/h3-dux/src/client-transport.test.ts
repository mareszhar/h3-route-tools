import type { App } from '@test'
import { createClient, createTypedFetch } from '@mszr/h3-dux'
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

it('serializes logical request scalars without surprising stringification', async () => {
  const urls: string[] = []
  const headersSeen: Array<string | null> = []
  const at = new Date('2026-01-02T03:04:05.000Z')

  const api = createClient<App>({
    fetch: (url, init) => {
      urls.push(url)
      headersSeen.push(new Headers(init?.headers).get('x-at'))
      return json({ status: 'ripe', at: 'now' })
    },
  })

  await api.get('/health', {
    query: {
      at,
      active: true,
      count: 2,
      tag: ['a', at, undefined],
      skip: undefined,
      none: null,
    } as never,
    headers: { 'x-at': at, 'x-skip': undefined } as never,
  }).orThrow()

  expect(urls[0]).toBe('/health?at=2026-01-02T03%3A04%3A05.000Z&active=true&count=2&tag=a&tag=2026-01-02T03%3A04%3A05.000Z')
  expect(headersSeen).toEqual(['2026-01-02T03:04:05.000Z'])
})

it('reports unserializable request scalars through the honest transport error channel', async () => {
  const api = createClient<App>({
    fetch: () => json({ status: 'ripe', at: 'now' }),
  })

  const { data, error } = await api.get('/health', {
    query: { nested: { no: 'silent object stringification' } } as never,
  })

  expect(data).toBeUndefined()
  expect(error?.kind).toBe('transport')
  expect(error?.cause).toBeInstanceOf(TypeError)
})

it('keeps the custom query serializer as the escape hatch for non-scalar query shapes', async () => {
  const urls: string[] = []
  const api = createClient<App>({
    querySerializer(params) {
      return new URLSearchParams({ filter: JSON.stringify(params.filter) })
    },
    fetch: (url) => {
      urls.push(url)
      return json({ status: 'ripe', at: 'now' })
    },
  })

  await api.get('/health', {
    query: { filter: { color: 'green' } } as never,
  }).orThrow()

  expect(urls[0]).toBe('/health?filter=%7B%22color%22%3A%22green%22%7D')
})

it('applies the same request scalar rules to the bare typed fetch baseline', async () => {
  interface Routes {
    '/items/:id': {
      get: {
        params: { id: Date }
        query: { tag: Array<string | Date | undefined>, active: boolean }
        headers: { 'x-at': Date }
        response: { ok: true }
      }
    }
  }

  const urls: string[] = []
  const headersSeen: Array<string | null> = []
  const at = new Date('2026-01-02T03:04:05.000Z')
  const api = createTypedFetch<Routes>({
    fetch: (url, init) => {
      urls.push(url)
      headersSeen.push(new Headers(init?.headers).get('x-at'))
      return json({ ok: true })
    },
  })

  await api('/items/:id', {
    method: 'get',
    params: { id: at },
    query: { tag: ['a', at, undefined], active: false },
    headers: { 'x-at': at },
  })

  expect(urls[0]).toBe('/items/2026-01-02T03%3A04%3A05.000Z?tag=a&tag=2026-01-02T03%3A04%3A05.000Z&active=false')
  expect(headersSeen).toEqual(['2026-01-02T03:04:05.000Z'])
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
