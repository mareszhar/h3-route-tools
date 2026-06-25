import { defineFileRoute } from '@mszr/h3-dux'
import * as v from 'valibot'
import { FruitSchema, orchard } from '../../utils/orchard.ts'

// routes/fruits/[id].get.ts → GET /fruits/:id (codegen maps [id] → :id).
export default defineFileRoute({
  params: v.object({ id: v.string() }),
  validate: { response: FruitSchema },
  handler: e => orchard.get(e.params.id),
})
