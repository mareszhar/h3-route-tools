import { defineFileRoute } from '@mszr/h3-dux'
import { ErrorSchema, FruitSchema, NewFruitSchema } from '@orchard/domain'
import { requireKey } from '../../utils/auth.ts'
import { rethrowDomain } from '../../utils/errors.ts'
import { orchard } from '../../utils/orchard.ts'

export default defineFileRoute({
  status: 201,
  validate: { body: NewFruitSchema, response: FruitSchema },
  errors: { 401: ErrorSchema, 409: ErrorSchema },
  handler: (e) => {
    try {
      requireKey(e)
      return orchard.create(e.body)
    }
    catch (cause) {
      rethrowDomain(e, cause)
    }
  },
})
