import { defineHandler, getRouterParam } from "h3";
import { requireKey } from "../../utils/auth.ts";
import { orchard } from "../../utils/orchard.ts";

/** DELETE /fruits/:id — remove a fruit (requires the write key). */
export default defineHandler((event) => {
  requireKey(event);
  orchard.remove(getRouterParam(event, "id")!);
  event.res.status = 204;
  return null;
});
