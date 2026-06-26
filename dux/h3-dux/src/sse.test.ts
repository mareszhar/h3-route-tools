import type { App } from '@test'
import { createClient, H3DuxHTTPError } from '@mszr/h3-dux'
import { app } from '@test'
import { expect, it } from 'vitest'

const api = createClient<App>({ fetch: app.request })

it('consumes an SSE endpoint as a typed async iterator', async () => {
  const ripeness: number[] = []
  for await (const tick of api.get('/fruits/:id/ripen', { params: { id: 'kiwi' } }))
    ripeness.push(tick.ripeness)

  expect(ripeness.length).toBeGreaterThan(0)
  expect(ripeness.at(-1)).toBe(100) // ripens until perfectly ripe
})

// ── SSE parser hardening (delta 10) ───────────────────────────────────────────
// A client whose transport returns a hand-crafted event-stream, so we drive the
// hardened parser through the real `for await` path (not an exported internal).

function sseClient(body: string, init?: ResponseInit) {
  return createClient<App>({
    fetch: () => new Response(body, { headers: { 'content-type': 'text/event-stream' }, ...init }),
  })
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable)
    out.push(item)
  return out
}

function ripen(client: ReturnType<typeof sseClient>) {
  return client.get('/fruits/:id/ripen', { params: { id: 'x' } })
}

it('handles CRLF line endings and skips comment / id / retry lines', async () => {
  const body = ':ok\r\nretry: 1000\r\n\r\nid: 1\r\ndata: {"id":"x","ripeness":40,"at":"t"}\r\n\r\n'
  const ticks = await collect(ripen(sseClient(body)))
  expect(ticks).toEqual([{ id: 'x', ripeness: 40, at: 't' }])
})

it('handles mixed valid line endings at frame boundaries', async () => {
  const body = [
    'data: {"id":"x","ripeness":20,"at":"a"}\n\r\n',
    'data: {"id":"x","ripeness":40,"at":"b"}\r\r\n',
    'data: {"id":"x","ripeness":60,"at":"c"}\r\n\n',
  ].join('')
  const ticks = await collect(ripen(sseClient(body)))
  expect(ticks.map(tick => tick.ripeness)).toEqual([20, 40, 60])
})

it('accumulates a multi-line data payload (joined with \\n)', async () => {
  const body = 'data: {"id":"x",\ndata: "ripeness":60,\ndata: "at":"t"}\n\n'
  const ticks = await collect(ripen(sseClient(body)))
  expect(ticks).toEqual([{ id: 'x', ripeness: 60, at: 't' }])
})

it('flushes a final frame with no terminating blank line', async () => {
  const body = 'data: {"id":"x","ripeness":100,"at":"t"}'
  const ticks = await collect(ripen(sseClient(body)))
  expect(ticks).toEqual([{ id: 'x', ripeness: 100, at: 't' }])
})

it('a non-ok SSE response throws a H3DuxHTTPError instead of yielding nothing', async () => {
  const failing = sseClient('', { status: 503 })
  await expect(collect(ripen(failing))).rejects.toBeInstanceOf(H3DuxHTTPError)
})
