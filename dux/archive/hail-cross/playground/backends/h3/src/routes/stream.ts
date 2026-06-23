import type { H3 } from "h3";
import { createEventStream, getRouterParam } from "h3";
import { orchard } from "../orchard.ts";

/** Server-Sent Events: stream ripeness ticks until the fruit is ripe. */
export function streamRoutes(app: H3) {
  app.get("/fruits/:id/ripen", (event) => {
    const id = getRouterParam(event, "id")!;
    orchard.get(id); // throws NotFoundError (→ 404) before we open the stream

    const stream = createEventStream(event);
    void (async () => {
      for await (const tick of orchard.ripen(id))
        await stream.push({ event: "ripen", data: JSON.stringify(tick) });
      await stream.close();
    })();

    return stream.send();
  });
}
