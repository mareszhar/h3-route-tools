import { defineFileRoute } from '@mszr/h3-dux'
import { ErrorSchema, FruitSchema } from '@orchard/domain'
import { rethrowDomain } from '../../utils/errors.ts'
import { orchard } from '../../utils/orchard.ts'

export default defineFileRoute({
  validate: { response: FruitSchema },
  errors: { 404: ErrorSchema },
  handler: (e) => {
    try {
      return orchard.get(e.params.id!)
    }
    catch (cause) {
      rethrowDomain(e, cause)
    }
  },
})
