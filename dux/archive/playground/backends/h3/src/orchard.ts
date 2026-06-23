import { createOrchard } from '@orchard/domain'

/** One shared in-memory repository for the whole h3 app. */
export const orchard = createOrchard()
