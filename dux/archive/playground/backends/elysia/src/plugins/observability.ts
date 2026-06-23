import { Elysia } from 'elysia'

/** Logs `METHOD /path → status (duration)` for every request. */
export const observability = new Elysia({ name: 'orchard/observability' })
  .state('startedAt', 0)
  .onRequest(({ store }) => {
    store.startedAt = performance.now()
  })
  .onAfterResponse(({ request, store, set }) => {
    const ms = (performance.now() - store.startedAt).toFixed(1)
    const { pathname } = new URL(request.url)
    console.log(`${request.method} ${pathname} → ${set.status} ${ms}ms`)
  })
