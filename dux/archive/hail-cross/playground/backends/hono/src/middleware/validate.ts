import type { Context } from "hono";
import { sValidator } from "@hono/standard-validator";

export { sValidator };

/**
 * Shared failure hook for `sValidator`: rewrites validation problems into the
 * Orchard error envelope with a 422 instead of Hono's default 400 text.
 */
export function onInvalid(
  result: { success: true } | { success: false; error?: ReadonlyArray<{ message: string }> },
  c: Context
) {
  if (!result.success) {
    return c.json(
      { error: "validation", message: result.error?.[0]?.message ?? "Request failed validation" },
      422
    );
  }
}
