import { createEventStream, defineHandler, getRouterParam } from "h3";
import { orchard } from "../../../utils/orchard.ts";

/** GET /fruits/:id/ripen — Server-Sent Events of ripeness ticks. */
export default defineHandler((event) => {
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
