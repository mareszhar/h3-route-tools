import { NewFruitSchema } from "@orchard/domain";
import { defineHandler, readValidatedBody } from "h3";
import { requireKey } from "../../utils/auth.ts";
import { orchard } from "../../utils/orchard.ts";
import { validationOptions } from "../../utils/validate.ts";

/** POST /fruits — create a fruit (requires the write key). */
export default defineHandler(async (event) => {
  requireKey(event);
  const fruit = orchard.create(await readValidatedBody(event, NewFruitSchema, validationOptions));
  event.res.status = 201;
  return fruit;
});
