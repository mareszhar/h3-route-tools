import { FruitPatchSchema } from "@orchard/domain";
import { defineHandler, getRouterParam, readValidatedBody } from "h3";
import { requireKey } from "../../utils/auth.ts";
import { orchard } from "../../utils/orchard.ts";
import { validationOptions } from "../../utils/validate.ts";

/** PATCH /fruits/:id — partial update (requires the write key). */
export default defineHandler(async (event) => {
  requireKey(event);
  return orchard.update(
    getRouterParam(event, "id")!,
    await readValidatedBody(event, FruitPatchSchema, validationOptions)
  );
});
