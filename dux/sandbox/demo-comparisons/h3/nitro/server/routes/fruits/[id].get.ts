import { defineHandler, getRouterParam } from 'h3'
import { orchard } from '../../utils/orchard.ts'

/** GET /fruits/:id — one fruit, or a 404. */
export default defineHandler(event => orchard.get(getRouterParam(event, 'id')!))
