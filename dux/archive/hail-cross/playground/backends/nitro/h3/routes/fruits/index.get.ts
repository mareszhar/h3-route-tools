import { FruitQuerySchema } from "@orchard/domain";
import { defineHandler, getValidatedQuery } from "h3";
import { orchard } from "../../utils/orchard.ts";
import { validationOptions } from "../../utils/validate.ts";

/** GET /fruits — filter + sort + cursor pagination. */
export default defineHandler(async (event) =>
  orchard.list(await getValidatedQuery(event, FruitQuerySchema, validationOptions))
);
