import { defineFileRoute } from '@mszr/h3-dux'
import { ErrorSchema } from '@orchard/domain'
import { requireKey } from '../../utils/auth.ts'
import { rethrowDomain } from '../../utils/errors.ts'
import { orchard } from '../../utils/orchard.ts'

export default defineFileRoute({
  status: 204,
  errors: { 401: ErrorSchema, 404: ErrorSchema },
  handler: (e) => {
    try {
      requireKey(e)
      orchard.remove(e.params.id!)
      return null
    }
    catch (cause) {
      rethrowDomain(e, cause)
    }
  },
})
