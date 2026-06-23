import { ORCHARD_KEY, ORCHARD_KEY_HEADER, UnauthorizedError } from "@orchard/domain";
import { Elysia } from "elysia";

const writeKey = process.env.ORCHARD_KEY ?? ORCHARD_KEY;

/**
 * Exposes a `requireKey` macro. Add `{ requireKey: true }` to any route to
 * gate it behind the `x-orchard-key` header.
 */
export const auth = new Elysia({ name: "orchard/auth" }).macro({
  requireKey: {
    resolve({ headers }) {
      if (headers[ORCHARD_KEY_HEADER] !== writeKey) throw new UnauthorizedError();
      return {};
    },
  },
});
