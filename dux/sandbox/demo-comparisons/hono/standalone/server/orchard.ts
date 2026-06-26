import { createOrchard } from '@orchard/domain'

/** One shared in-memory repository for the whole Hono app. */
export const orchard = createOrchard()
