import { createOrchard } from '@orchard/domain'

/** One shared in-memory repository for the whole Nitro app. */
export const orchard = createOrchard()
