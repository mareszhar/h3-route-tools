import { defineValidatedHandler } from "../../src/route-handler.ts";
import { z } from "zod";

// Stands in for a method-agnostic single-method handler (defineValidatedHandler) — no method keys.
export default defineValidatedHandler({
  params: z.object({ id: z.coerce.number() }),
  validate: { response: z.object({ id: z.number(), when: z.date() }) },
  handler: (event) => ({ id: event.context.params.id, when: new Date(0) }),
});
