import type { H3DuxEvent } from '@mszr/h3-dux'
import { ORCHARD_KEY, ORCHARD_KEY_HEADER, UnauthorizedError } from '@orchard/domain'
import { toDuxError } from './errors.ts'

const writeKey = process.env.ORCHARD_KEY ?? ORCHARD_KEY

export function requireKey(e: H3DuxEvent): void {
  if (e.req.headers.get(ORCHARD_KEY_HEADER) !== writeKey)
    throw toDuxError(e, new UnauthorizedError())
}
