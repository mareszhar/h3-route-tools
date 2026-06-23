import { app } from "@orchard/backend-nitro-hono";
import { makeHonoClient, runHonoTrip } from "@orchard/client-hono/trip";

// Nitro hosts this exact Hono app in production (see the backend's routes/[...].ts).
// The hc client is identical — fully type-safe — so we reuse the shared trip,
// running it in-process against the same app for a fast, isolated demo.
await runHonoTrip("Nitro (Hono server entry) · hc RPC shopping trip", makeHonoClient(app.request));

process.exit(0);
