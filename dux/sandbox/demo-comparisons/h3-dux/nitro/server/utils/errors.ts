import type { H3DuxEvent } from '@mszr/h3-dux'
import { OrchardError } from '@orchard/domain'

// `H3DuxEvent` is the route-agnostic handler event — no interface to hand-roll.
export function toDuxError(e: H3DuxEvent, error: OrchardError): Error {
  return e.error(error.status, error.toBody())
}

export function rethrowDomain(e: H3DuxEvent, cause: unknown): never {
  if (cause instanceof OrchardError)
    throw toDuxError(e, cause)
  throw cause
}
