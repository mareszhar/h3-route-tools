import { app } from "@orchard/backend-nitro-elysia";
import { makeElysiaClient, runElysiaTrip } from "@orchard/client-elysia/trip";

// Nitro hosts this exact Elysia app in production (see the backend's routes/[...].ts).
// Eden Treaty is identical — fully type-safe — so we reuse the shared trip,
// running it in-process against the same app for a fast, isolated demo.
await runElysiaTrip(
  "Nitro (Elysia server entry) · Eden Treaty shopping trip",
  makeElysiaClient(app)
);

process.exit(0);
