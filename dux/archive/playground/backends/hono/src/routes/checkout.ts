import { CheckoutOrderSchema } from "@orchard/domain";
import { Hono } from "hono";
import { onInvalid, sValidator } from "../middleware/validate.ts";
import { orchard } from "../orchard.ts";

/** Cross-entity business op: validates basket stock, then bills it. */
export const checkout = new Hono().post(
  "/checkout",
  sValidator("json", CheckoutOrderSchema, onInvalid),
  (c) => c.json(orchard.checkout(c.req.valid("json")), 200)
);
