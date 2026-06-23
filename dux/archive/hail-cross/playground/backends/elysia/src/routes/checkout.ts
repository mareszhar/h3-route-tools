import { CheckoutOrderSchema, ErrorSchema, ReceiptSchema } from "@orchard/domain";
import { Elysia } from "elysia";
import { context } from "../plugins/context.ts";

/** Cross-entity business op: validates basket stock, then bills it. */
export const checkout = new Elysia({ name: "orchard/checkout" })
  .use(context)
  .post("/checkout", ({ orchard, body }) => orchard.checkout(body), {
    body: CheckoutOrderSchema,
    response: { 200: ReceiptSchema, 404: ErrorSchema, 409: ErrorSchema },
  });
