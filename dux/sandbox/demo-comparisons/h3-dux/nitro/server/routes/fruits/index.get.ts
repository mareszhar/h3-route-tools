import { defineFileRoute } from '@mszr/h3-dux'
import { FruitPageSchema, FruitQuerySchema } from '@orchard/domain'
import { orchard } from '../../utils/orchard.ts'

export default defineFileRoute({
  validate: { query: FruitQuerySchema, response: FruitPageSchema },
  handler: e => orchard.list(e.query),
})
