import type { App } from '@test'
import { createClient } from '@mszr/h3-dux'
import { app } from '@test'
import { expect, it } from 'vitest'

const api = createClient<App>({ fetch: app.request })

it('consumes an SSE endpoint as a typed async iterator', async () => {
  const ripeness: number[] = []
  for await (const tick of api.get('/fruits/:id/ripen', { params: { id: 'kiwi' } }))
    ripeness.push(tick.ripeness)

  expect(ripeness.length).toBeGreaterThan(0)
  expect(ripeness.at(-1)).toBe(100) // ripens until perfectly ripe
})
