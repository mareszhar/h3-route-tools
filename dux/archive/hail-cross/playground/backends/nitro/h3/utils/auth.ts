import type { H3Event } from "h3";
import { ORCHARD_KEY, ORCHARD_KEY_HEADER, UnauthorizedError } from "@orchard/domain";

const writeKey = process.env.ORCHARD_KEY ?? ORCHARD_KEY;

/** Call at the top of a write handler to gate it behind the `x-orchard-key` header. */
export function requireKey(event: H3Event): void {
  if (event.req.headers.get(ORCHARD_KEY_HEADER) !== writeKey) throw new UnauthorizedError();
}
