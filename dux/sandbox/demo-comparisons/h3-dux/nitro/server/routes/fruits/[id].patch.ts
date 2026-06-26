import { defineFileRoute } from '@mszr/h3-dux'
import { ErrorSchema, FruitPatchSchema, FruitSchema } from '@orchard/domain'
import { requireKey } from '../../utils/auth.ts'
import { rethrowDomain } from '../../utils/errors.ts'
import { orchard } from '../../utils/orchard.ts'

export default defineFileRoute({
  validate: { body: FruitPatchSchema, response: FruitSchema },
  errors: { 401: ErrorSchema, 404: ErrorSchema },
  handler: (e) => {
    try {
      requireKey(e)
      return orchard.update(e.params.id!, e.body)
    }
    catch (cause) {
      rethrowDomain(e, cause)
    }
  },
})
