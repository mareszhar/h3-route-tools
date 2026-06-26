import { ORCHARD_KEY, ORCHARD_KEY_HEADER, UnauthorizedError } from '@orchard/domain'
import { toDuxError } from './errors.ts'

const writeKey = process.env.ORCHARD_KEY ?? ORCHARD_KEY

export function requireKey(e: { req: Request, error: (status: any, body: any) => Error }): void {
  if (e.req.headers.get(ORCHARD_KEY_HEADER) !== writeKey)
    throw toDuxError(e, new UnauthorizedError())
}
