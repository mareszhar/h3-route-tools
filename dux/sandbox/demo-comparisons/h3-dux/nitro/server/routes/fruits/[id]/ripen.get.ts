import { defineFileRoute, sse } from '@mszr/h3-dux'
import { ErrorSchema, RipenTickSchema } from '@orchard/domain'
import { rethrowDomain } from '../../../utils/errors.ts'
import { orchard } from '../../../utils/orchard.ts'

export default defineFileRoute({
  validate: { response: sse(RipenTickSchema) },
  errors: { 404: ErrorSchema },
  async* handler(e) {
    try {
      for await (const tick of orchard.ripen(e.params.id!))
        yield tick
    }
    catch (cause) {
      rethrowDomain(e, cause)
    }
  },
})
