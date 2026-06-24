/**
 * A narrated "shopping trip" across every endpoint, driven by the typed client
 * against the in-process app. Run it: `bun run trip` (from this folder).
 *
 * Every call is typed end-to-end from `typeof app`. The client is honest: a call
 * resolves to `{ data, error }`, with `.orThrow()` for the value and `.raw()` for
 * the native response. The error channel is discriminated and typed per status.
 */
import type { App } from './server.ts'
import { createTestClient } from '@mszr/h3-dux'
import { app } from './server.ts'

// In-process transport, named so it's never mistaken for a browser client.
const api = createTestClient<App>(app)

function show(label: string, value: unknown): void {
  console.log(`\n● ${label}`)
  console.dir(value, { depth: null })
}

// `.orThrow()` — the one-liner when you want failures to bubble. Response inferred.
show('GET /health', await api.get('/health').orThrow())

show('GET /fruits', await api.get('/fruits').orThrow())

// Data-first: `{ data, error }`. `status` made it a 201; `data` is the created Fruit.
const created = await api.post('/fruits', {
  body: { name: 'Lychee', emoji: '🫐', pricePerKg: 12, stockKg: 3 },
})

show('POST /fruits → data', created.data)

// The body typechecks, but -5 fails the schema at runtime → a typed 422 in `error`.
const invalid = await api.post('/fruits', {
  body: { name: 'Bruised', emoji: '🤕', pricePerKg: -5, stockKg: 1 },
})
if (invalid.error?.kind === 'http')
  show(`POST /fruits (invalid) → ${invalid.error.status}`, invalid.error.data)

// Path interpolation + `.orThrow()`.
show('GET /fruits/:id (interpolated)', await api.get(`/fruits/mango`).orThrow())

// A typed error: GET a missing fruit → discriminated 404, `error.data` is the ErrorSchema shape.
const missing = await api.get('/fruits/:id', { params: { id: 'durian' } })
if (missing.error?.kind === 'http' && missing.error.status === 404)
  show('GET /fruits/durian → 404', missing.error.data)

show('POST /checkout', await api.post('/checkout', { body: { items: [{ id: 'mango', kg: 2 }] } }).orThrow())

// Typed SSE — a real async iterator of RipenTick.
console.log('\n● GET /fruits/:id/ripen (SSE)')
for await (const tick of api.get(`/fruits/kiwi/ripen`))
  console.log(`  ripeness → ${tick.ripeness}`)

// Manual mode: a dry-run skips body validation entirely.
show('POST /import?mode=dry-run', await api.post('/import', { query: { mode: 'dry-run' }, body: [] }).orThrow())

// The web-standard escape hatch: `.raw()` for status/headers.
const raw = await api.get('/health').raw()
show(`GET /health (raw) → ${raw.status}`, await raw.json())

console.log('\n✓ trip complete\n')
