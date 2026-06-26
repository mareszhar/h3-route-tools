import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { orchard } from '../orchard.ts'

/** Server-Sent Events: stream ripeness ticks until the fruit is ripe. */
export const stream = new Hono().get('/fruits/:id/ripen', c =>
  streamSSE(c, async (sse) => {
    for await (const tick of orchard.ripen(c.req.param('id')))
      await sse.writeSSE({ event: 'ripen', data: JSON.stringify(tick) })
  }))
