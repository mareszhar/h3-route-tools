import { defineFileRoute } from '@mszr/h3-dux'
import * as v from 'valibot'
import { FruitSchema, orchard } from '../../utils/orchard.ts'

// routes/fruits/index.get.ts → GET /fruits
export default defineFileRoute({
  validate: { response: v.array(FruitSchema) },
  handler: () => orchard.list(),
})
