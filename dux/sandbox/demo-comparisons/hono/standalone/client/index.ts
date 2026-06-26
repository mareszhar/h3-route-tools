import { app } from '@orchard/backend-hono'
import { makeHonoClient, runHonoTrip } from './trip.ts'

// `hc<App>` infers the whole RPC surface from the server's route types.
// We hand it `app.request` as the fetch impl, so it runs in-process — no port.
await runHonoTrip('Hono · hc RPC shopping trip', makeHonoClient(app.request))

// Type-safety proof — uncommenting fails to compile (pricePerKg is required):
// makeHonoClient(app.request).fruits.$post({ json: { name: 'Lychee', emoji: '🫐', color: 'pink', tags: [], stockKg: 1 } })

process.exit(0)
