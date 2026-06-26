import { defineFileRoute } from '@mszr/h3-dux'
import { CheckoutOrderSchema, ErrorSchema, ReceiptSchema } from '@orchard/domain'
import { rethrowDomain } from '../utils/errors.ts'
import { orchard } from '../utils/orchard.ts'

export default defineFileRoute({
  validate: { body: CheckoutOrderSchema, response: ReceiptSchema },
  errors: { 404: ErrorSchema, 409: ErrorSchema },
  handler: (e) => {
    try {
      return orchard.checkout(e.body)
    }
    catch (cause) {
      rethrowDomain(e, cause)
    }
  },
})
