/**
 * `toNitroHandler` (issue B). Mounting a programmatic dux app under Nitro must
 * re-enter the app through *its own* h3 — so h3 response helpers like `handleCors`
 * see the event shape they expect even when Nitro built the incoming event with a
 * different (pinned, older) h3 copy — while forwarding Nitro's `event.context` so
 * request-scoped state (CF bindings, `waitUntil`, staged values) survives.
 *
 * A single h3 copy is resolved here, so this can't reproduce the two-build crash
 * directly; it locks the two behaviors that make the crash impossible regardless:
 * the app builds its own event (CORS works), and the outer context is carried in.
 */
import { H3Event, handleCors } from 'h3'
import { expect, it } from 'vitest'
import { createServer, toNitroHandler } from './index.ts'

const app = createServer()
  .use((event) => {
    const preflight = handleCors(event, {
      origin: ['http://localhost:3001'],
      methods: ['GET', 'OPTIONS'],
    })
    if (preflight)
      return preflight
  })
  .get('/hello', event => ({ message: 'hello', tenant: event.context.tenant as string | undefined }))

const handler = toNitroHandler(app)

/** Stand in for the event Nitro hands its catch-all: a plain Request + a populated context. */
function nitroEvent(url: string, init?: RequestInit, context?: Record<string, unknown>): H3Event {
  return new H3Event(new Request(url, init), context)
}

it('re-enters via the app\'s own h3 so handleCors works on a foreign event', async () => {
  const res = await handler(nitroEvent('http://localhost:3000/hello', {
    headers: { origin: 'http://localhost:3001' },
  }))
  expect(res.status).toBe(200)
  expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3001')
})

it('forwards nitro event.context into the dux handler', async () => {
  const res = await handler(nitroEvent(
    'http://localhost:3000/hello',
    { headers: { origin: 'http://localhost:3001' } },
    { tenant: 'acme' },
  ))
  expect(await res.json()).toEqual({ message: 'hello', tenant: 'acme' })
})

it('answers a CORS preflight', async () => {
  const res = await handler(nitroEvent('http://localhost:3000/hello', {
    method: 'OPTIONS',
    headers: {
      'origin': 'http://localhost:3001',
      'access-control-request-method': 'GET',
    },
  }))
  expect(res.status).toBe(204)
  expect(res.headers.get('access-control-allow-methods')).toContain('GET')
})

it('denies a disallowed origin (no ACAO header), still 200', async () => {
  const res = await handler(nitroEvent('http://localhost:3000/hello', {
    headers: { origin: 'http://evil.example' },
  }))
  expect(res.status).toBe(200)
  expect(res.headers.get('access-control-allow-origin')).toBeNull()
})
