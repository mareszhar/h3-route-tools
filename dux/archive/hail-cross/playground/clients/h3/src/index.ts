import { app } from "@orchard/backend-h3";
import { createOrchardClient, runFetchTrip } from "@orchard/domain";

// h3 ships no RPC client, so we use the shared web-standard typed-fetch client.
// Passing the app's `fetch` runs every call in-process — no server, no port —
// and responses are typed via the same valibot schemas the server validates.
const fetcher = (req: Request) => app.fetch(req);

await runFetchTrip(
  "h3 · web-standard typed-fetch shopping trip",
  createOrchardClient({ fetch: fetcher }),
  createOrchardClient({ fetch: fetcher, key: "wrong-key" })
);

// Type-safety proof — uncommenting fails to compile (pricePerKg is required):
// await createOrchardClient({ fetch: fetcher }).createFruit({ name: 'Lychee', emoji: '🫐', color: 'pink', tags: [], stockKg: 1 })

process.exit(0);
