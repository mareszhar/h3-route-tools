import { HTTPError } from 'h3'

/**
 * Shared options for h3's `readValidatedBody` / `getValidatedQuery`. Valibot
 * schemas are Standard Schemas, so h3 accepts them directly; this hook turns a
 * failure into a 422 carrying the Orchard error envelope.
 */
export const validationOptions = {
  onError: (result: { issues?: ReadonlyArray<{ message?: string }> }) =>
    new HTTPError({
      status: 422,
      message: result.issues?.[0]?.message ?? 'Request failed validation',
      data: { error: 'validation' },
    }),
}
