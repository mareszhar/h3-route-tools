import type { Middleware } from 'h3'

/** Logs `METHOD /path → status (duration)` for every request. */
export const observability: Middleware = async (event, next) => {
  const startedAt = performance.now()
  const result = await next()
  const ms = (performance.now() - startedAt).toFixed(1)
  console.log(
    `${event.req.method} ${new URL(event.req.url).pathname} → ${event.res.status ?? 200} ${ms}ms`,
  )
  return result
}
