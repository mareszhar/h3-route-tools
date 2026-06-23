import { defineRouteHandler } from '@mszr/h3-dux'
import * as v from 'valibot'
import { FruitSchema, orchard } from '../../utils/orchard.ts'

// routes/fruits/[id].get.ts → GET /fruits/:id (codegen maps [id] → :id)
export default defineRouteHandler({
  params: v.object({ id: v.string() }),
  get: {
    validate: { response: FruitSchema },
    handler: e => orchard.get(e.context.params.id),
  },
})
