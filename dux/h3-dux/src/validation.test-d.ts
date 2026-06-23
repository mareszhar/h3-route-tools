import type { NewFruit } from '@test'
import { createServer } from '@mszr/h3-dux'
import { NewFruitSchema } from '@test'
import * as v from 'valibot'
import { expectTypeOf, test } from 'vitest'

test('eager mode: context accessors are typed', () => {
  createServer().post('/x', {
    validate: { body: NewFruitSchema, query: v.object({ q: v.string() }) },
    handler: (e) => {
      expectTypeOf(e.context.body).toEqualTypeOf<NewFruit>()
      expectTypeOf(e.context.query).toEqualTypeOf<{ q: string }>()
      return null
    },
  })
})

test('manual mode: valid(scope) is typed and limited to declared scopes', () => {
  createServer().post('/x', {
    validate: { body: NewFruitSchema, query: v.object({ q: v.string() }), eager: false },
    handler: async (e) => {
      expectTypeOf(await e.valid('body')).toEqualTypeOf<NewFruit>()
      expectTypeOf(await e.valid('query')).toEqualTypeOf<{ q: string }>()
      // @ts-expect-error — headers declares no schema, so it is not validatable
      await e.valid('headers')
      return null
    },
  })
})
