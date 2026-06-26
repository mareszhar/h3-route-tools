import type { OrchardError } from '@orchard/domain'

interface DuxErrorEvent {
  error: (status: any, body: any) => Error
}

export function toDuxError(
  e: DuxErrorEvent,
  error: OrchardError,
): Error {
  return e.error(error.status, error.toBody())
}

export function rethrowDomain(
  e: DuxErrorEvent,
  cause: unknown,
): never {
  if (cause && typeof cause === 'object' && 'status' in cause && 'toBody' in cause)
    throw toDuxError(e, cause as OrchardError)
  throw cause
}
