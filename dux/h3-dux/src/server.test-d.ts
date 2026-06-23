import type { NewFruit } from '@test'
import { createServer } from '@mszr/h3-dux'
import { NewFruitSchema } from '@test'
import * as v from 'valibot'
import { expectTypeOf, test } from 'vitest'

test('params are inferred from the route pattern, no schema needed', () => {
  createServer().get('/fruits/:id', {
    handler: (e) => {
      expectTypeOf(e.context.params).toEqualTypeOf<{ id: string }>()
      return null
    },
  })
})

test('a params schema overrides the inferred string params', () => {
  createServer().get('/fruits/:id', {
    params: v.object({ id: v.pipe(v.string(), v.transform(Number)) }),
    handler: (e) => {
      expectTypeOf(e.context.params.id).toEqualTypeOf<number>()
      return null
    },
  })
})

test('validate.body types the handler body', () => {
  createServer().post('/fruits', {
    validate: { body: NewFruitSchema },
    handler: async (e) => {
      expectTypeOf(await e.req.json()).toEqualTypeOf<NewFruit>()
      return e.context.params
    },
  })
})

test('a bodyless verb forbids validate.body', () => {
  createServer().get('/x', {
    // @ts-expect-error — GET takes no body
    validate: { body: NewFruitSchema },
    handler: () => null,
  })
})
