/**
 * A narrated "shopping trip" across every endpoint, driven by the typed client
 * against the in-process app. Run it: `bun run trip` (from this folder).
 *
 * Every call below is typed end-to-end from `typeof app` — the response shapes,
 * the path params, the request bodies, and the SSE element type.
 */
import type { App } from './server.ts'
import { createClient } from '@mszr/h3-dux'
import { app } from './server.ts'

const api = createClient<App>({ fetch: app.request })

function show(label: string, value: unknown): void {
  console.log(`\n● ${label}`)
  console.dir(value, { depth: null })
}

// Response inferred from the handler — `{ status: 'ripe'; at: string }`.
show('GET /health', await (await api.get('/health')).json())

show('GET /fruits', await (await api.get('/fruits')).json())

// Verb sugar + typed body; `status` makes it a 201.
const created = await api.post('/fruits', {
  body: { name: 'Lychee', emoji: '🫐', pricePerKg: 12, stockKg: 3 },
})
show(`POST /fruits → ${created.status}`, await created.json())

// The body typechecks, but -5 fails the schema's minValue(0) at runtime.
const invalid = await api.post('/fruits', {
  body: { name: 'Bruised', emoji: '🤕', pricePerKg: -5, stockKg: 1 },
})
show(`POST /fruits (invalid) → ${invalid.status}`, await invalid.json())

// Path interpolation resolves /fruits/:id.
show('GET /fruits/:id (interpolated)', await (await api.get(`/fruits/lychee`)).json())

show('POST /checkout', await (await api.post('/checkout', { body: { items: [{ id: 'mango', kg: 2 }] } })).json())

// Typed SSE — a real async iterator of RipenTick.
console.log('\n● GET /fruits/:id/ripen (SSE)')
for await (const tick of api.get(`/fruits/kiwi/ripen`))
  console.log(`  ripeness → ${tick.ripeness}`)

// Manual mode: a dry-run skips body validation entirely.
show('POST /import?mode=dry-run', await (await api.post('/import', { query: { mode: 'dry-run' }, body: [] })).json())

console.log('\n✓ trip complete\n')
