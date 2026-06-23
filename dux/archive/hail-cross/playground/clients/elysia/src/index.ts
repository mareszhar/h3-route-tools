import { app } from "@orchard/backend-elysia";
import { makeElysiaClient, runElysiaTrip } from "./trip.ts";

// Eden Treaty talks to the Elysia instance in-process — no server, no port,
// and the whole `api` surface is inferred from `typeof app`. Zero codegen.
await runElysiaTrip("Elysia · Eden Treaty shopping trip", makeElysiaClient(app));

// Type-safety proof — uncommenting fails to compile (pricePerKg is required):
// makeElysiaClient(app).fruits.post({ name: 'Lychee', emoji: '🫐', color: 'pink', tags: [], stockKg: 1 })

process.exit(0);
