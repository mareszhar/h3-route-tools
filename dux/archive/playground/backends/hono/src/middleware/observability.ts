import { createMiddleware } from 'hono/factory'

/** Logs `METHOD /path → status (duration)` for every request. */
export const observability = createMiddleware(async (c, next) => {
  const startedAt = performance.now()
  await next()
  const ms = (performance.now() - startedAt).toFixed(1)
  console.log(`${c.req.method} ${c.req.path} → ${c.res.status} ${ms}ms`)
})
