import { HTTPError } from "h3";

/**
 * Shared options for h3's validated readers. Valibot schemas are Standard
 * Schemas, so they pass straight through; failures become a 422 carrying the
 * Orchard envelope (rendered by the Nitro error handler).
 */
export const validationOptions = {
  onError: (result: { issues?: ReadonlyArray<{ message?: string }> }) =>
    new HTTPError({
      status: 422,
      message: result.issues?.[0]?.message ?? "Request failed validation",
      data: { error: "validation" },
    }),
};
