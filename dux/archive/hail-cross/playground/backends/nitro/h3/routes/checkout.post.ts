import { CheckoutOrderSchema } from "@orchard/domain";
import { defineHandler, readValidatedBody } from "h3";
import { orchard } from "../utils/orchard.ts";
import { validationOptions } from "../utils/validate.ts";

/** POST /checkout — validate the basket's stock, then bill it. */
export default defineHandler(async (event) =>
  orchard.checkout(await readValidatedBody(event, CheckoutOrderSchema, validationOptions))
);
