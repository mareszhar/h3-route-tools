import type { Middleware } from "h3";
import { ORCHARD_KEY, ORCHARD_KEY_HEADER, UnauthorizedError } from "@orchard/domain";

const writeKey = process.env.ORCHARD_KEY ?? ORCHARD_KEY;

/** Per-route middleware that gates writes behind the `x-orchard-key` header. */
export const requireKey: Middleware = (event, next) => {
  if (event.req.headers.get(ORCHARD_KEY_HEADER) !== writeKey) throw new UnauthorizedError();
  return next();
};
