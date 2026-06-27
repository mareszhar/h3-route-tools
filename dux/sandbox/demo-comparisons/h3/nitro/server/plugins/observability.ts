import type { HTTPEvent } from 'h3'
import { defineNitroPlugin } from 'nitro/runtime'

const startedAt = new WeakMap<Request, number>()

/** Logs `METHOD /path → status (duration)` via Nitro request hooks. */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('request', (event: HTTPEvent) => {
    startedAt.set(event.req, performance.now())
  })
  nitro.hooks.hook('response', (response: Response, event: HTTPEvent) => {
    const start = startedAt.get(event.req) ?? performance.now()
    const ms = (performance.now() - start).toFixed(1)
    console.log(
      `${event.req.method} ${new URL(event.req.url).pathname} → ${response.status} ${ms}ms`,
    )
  })
})
