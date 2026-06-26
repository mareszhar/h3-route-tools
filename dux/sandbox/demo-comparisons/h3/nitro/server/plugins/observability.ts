import { definePlugin } from 'nitro'

const startedAt = new WeakMap<Request, number>()

/** Logs `METHOD /path → status (duration)` via Nitro request hooks. */
export default definePlugin((nitro) => {
  nitro.hooks.hook('request', (event) => {
    startedAt.set(event.req, performance.now())
  })
  nitro.hooks.hook('response', (response, event) => {
    const start = startedAt.get(event.req) ?? performance.now()
    const ms = (performance.now() - start).toFixed(1)
    console.log(
      `${event.req.method} ${new URL(event.req.url).pathname} → ${response.status} ${ms}ms`,
    )
  })
})
