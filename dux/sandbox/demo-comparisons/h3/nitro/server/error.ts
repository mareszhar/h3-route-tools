import { OrchardError } from '@orchard/domain'
import { defineErrorHandler } from 'nitro'

/** Renders every thrown error as the shared Orchard envelope `{ error, message }`. */
export default defineErrorHandler((error) => {
  const status = error.status ?? 500
  const code
    = (error.data as { error?: string } | undefined)?.error
      ?? (error.cause instanceof OrchardError ? error.cause.code : undefined)
      ?? (status === 422
        ? 'validation'
        : status === 404
          ? 'not_found'
          : status === 401
            ? 'unauthorized'
            : 'internal')

  return Response.json(
    { error: code, message: error.message || 'Something bruised in the orchard 🍂' },
    { status },
  )
})
