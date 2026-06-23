import { ORCHARD_KEY, ORCHARD_KEY_HEADER, UnauthorizedError } from "@orchard/domain";
import { createMiddleware } from "hono/factory";

const writeKey = process.env.ORCHARD_KEY ?? ORCHARD_KEY;

/** Gates a route behind the `x-orchard-key` header. */
export const requireKey = createMiddleware(async (c, next) => {
  if (c.req.header(ORCHARD_KEY_HEADER) !== writeKey) throw new UnauthorizedError();
  await next();
});
