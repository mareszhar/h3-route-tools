import type { App, RipenTick } from '@test'
import { createClient } from '@mszr/h3-dux'
import { expectTypeOf, test } from 'vitest'

const api = createClient<App>({ baseURL: '' })

test('an sse() endpoint types the client as an AsyncGenerator, not a Promise', () => {
  expectTypeOf(api.get('/fruits/:id/ripen', { params: { id: 'm' } }))
    .toEqualTypeOf<AsyncGenerator<RipenTick>>()

  // The interpolated form streams too.
  expectTypeOf(api.get(`/fruits/${'m'}/ripen`))
    .toEqualTypeOf<AsyncGenerator<RipenTick>>()
})
