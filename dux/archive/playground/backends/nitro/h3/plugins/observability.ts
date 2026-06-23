import type { H3Event } from 'h3'
import { defineNitroPlugin } from 'nitro/runtime'

/** Logs `METHOD /path → status (duration)` via Nitro request hooks. */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('request', (event: H3Event) => {
    (event.context as { startedAt?: number }).startedAt = performance.now()
  })
  nitro.hooks.hook('afterResponse', (event: H3Event) => {
    const startedAt = (event.context as { startedAt?: number }).startedAt ?? performance.now()
    const ms = (performance.now() - startedAt).toFixed(1)
    console.log(
      `${event.req.method} ${new URL(event.req.url).pathname} → ${event.res.status ?? 200} ${ms}ms`,
    )
  })
})
