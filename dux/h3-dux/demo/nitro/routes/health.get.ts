import { defineFileRoute } from '@mszr/h3-dux'

// routes/health.get.ts → GET /health. The response is inferred from the handler.
export default defineFileRoute({
  handler: () => ({ status: 'ripe' as const, at: new Date().toISOString() }),
})
