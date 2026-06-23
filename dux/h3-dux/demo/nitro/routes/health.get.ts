import { defineRouteHandler } from '@mszr/h3-dux'

// routes/health.get.ts → GET /health
export default defineRouteHandler({
  get: { handler: () => ({ status: 'ripe' as const, at: new Date().toISOString() }) },
})
