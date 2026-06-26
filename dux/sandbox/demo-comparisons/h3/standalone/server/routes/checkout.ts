import type { H3 } from 'h3'
import { CheckoutOrderSchema } from '@orchard/domain'
import { readValidatedBody } from 'h3'
import { orchard } from '../orchard.ts'
import { validationOptions } from '../validate.ts'

/** Cross-entity business op: validates basket stock, then bills it. */
export function checkoutRoutes(app: H3) {
  app.post('/checkout', async event =>
    orchard.checkout(await readValidatedBody(event, CheckoutOrderSchema, validationOptions)))
}
