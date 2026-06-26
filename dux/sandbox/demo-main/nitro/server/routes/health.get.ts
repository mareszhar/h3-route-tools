import { defineFileRoute } from '@mszr/h3-dux'

// routes/health.get.ts → GET /health. No options needed, so pass the handler
// directly; the response is inferred from the return.
export default defineFileRoute(() => ({ status: 'ripe' as const, at: new Date().toISOString() }))
