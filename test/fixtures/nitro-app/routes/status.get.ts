import { defineValidatedHandler } from "h3-route-tools";
import * as v from "valibot";

// A method-locked file (`*.get.ts`) with the single-method primitive — nitro routes only GET here.
export default defineValidatedHandler({
  validate: { response: v.object({ ok: v.boolean(), service: v.string() }) },
  handler: () => ({ ok: true, service: "status" }),
});
