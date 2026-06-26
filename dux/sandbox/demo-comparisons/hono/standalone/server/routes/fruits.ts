import { FruitPatchSchema, FruitQuerySchema, NewFruitSchema } from '@orchard/domain'
import { Hono } from 'hono'
import { requireKey } from '../middleware/auth.ts'
import { onInvalid, sValidator } from '../middleware/validate.ts'
import { orchard } from '../orchard.ts'

/** CRUD for fruits, chained so the whole shape flows into the `hc` client. */
export const fruits = new Hono()
  .get('/', sValidator('query', FruitQuerySchema, onInvalid), c =>
    c.json(orchard.list(c.req.valid('query')), 200))
  .get('/:id', c => c.json(orchard.get(c.req.param('id')), 200))
  .post('/', requireKey, sValidator('json', NewFruitSchema, onInvalid), c =>
    c.json(orchard.create(c.req.valid('json')), 201))
  .patch('/:id', requireKey, sValidator('json', FruitPatchSchema, onInvalid), c =>
    // a preceding validator widens the path generic, so assert the guaranteed :id
    c.json(orchard.update(c.req.param('id')!, c.req.valid('json')), 200))
  .delete('/:id', requireKey, (c) => {
    orchard.remove(c.req.param('id'))
    return c.body(null, 204)
  })
