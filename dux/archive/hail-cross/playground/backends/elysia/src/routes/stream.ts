import { Elysia, sse } from "elysia";
import { context } from "../plugins/context.ts";

/** Server-Sent Events: stream ripeness ticks until the fruit is ripe. */
export const stream = new Elysia({ name: "orchard/stream" })
  .use(context)
  .get("/fruits/:id/ripen", async function* ({ orchard, params }) {
    for await (const tick of orchard.ripen(params.id)) yield sse({ event: "ripen", data: tick });
  });
