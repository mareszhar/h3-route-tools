import type { App } from '@orchard/backend-hono'
import type { ErrorBody } from '@orchard/domain'
import { narrate, ORCHARD_KEY, ORCHARD_KEY_HEADER } from '@orchard/domain'
import { hc } from 'hono/client'
import { readSSE } from './sse.ts'

const auth = { headers: { [ORCHARD_KEY_HEADER]: ORCHARD_KEY } }

/** Build an `hc` RPC client over any web-standard fetch (in-process or HTTP). */
export function makeHonoClient(fetch: NonNullable<Parameters<typeof hc>[1]>['fetch']) {
  return hc<App>('http://orchard.local', { fetch })
}

export type HonoClient = ReturnType<typeof makeHonoClient>

/** Narrow a typed hc response union to its 2xx body (throws on anything else). */
async function expectOk<T extends { ok: boolean, status: number, json: () => Promise<unknown> }>(
  res: T,
): Promise<Awaited<ReturnType<Extract<T, { ok: true }>['json']>>> {
  if (!res.ok)
    throw new Error(`Unexpected ${res.status}: ${JSON.stringify(await res.json())}`)
  return (res as Extract<T, { ok: true }>).json() as never
}

/** hc types success + validation; thrown auth/domain errors are read at runtime. */
const errorBody = (res: { json: () => Promise<unknown> }) => res.json() as Promise<ErrorBody>

/** The narrated hc shopping trip, shared by the Hono and Nitro-Hono clients. */
export async function runHonoTrip(label: string, client: HonoClient): Promise<void> {
  narrate.banner(label)

  narrate.step('GET /health')
  const health = await expectOk(await client.health.$get())
  narrate.ok('orchard is', health.status)

  narrate.step('GET /fruits — filter + sort + cursor pagination')
  const page1 = await expectOk(await client.fruits.$get({ query: { sort: 'price', limit: '2' } }))
  narrate.ok(
    'page 1',
    page1.items.map(f => f.emoji),
  )
  const page2 = await expectOk(
    await client.fruits.$get({
      query: { sort: 'price', limit: '2', cursor: page1.nextCursor ?? '' },
    }),
  )
  narrate.ok(
    'page 2',
    page2.items.map(f => f.emoji),
  )

  narrate.step('GET /fruits/:id')
  const apple = await expectOk(await client.fruits[':id'].$get({ param: { id: 'apple' } }))
  narrate.ok('fetched', `${apple.emoji} ${apple.name}`)

  narrate.step('GET /fruits/:id — missing → 404')
  const missing = await client.fruits[':id'].$get({ param: { id: 'dragonfruit' } })
  if (!missing.ok)
    narrate.expected('error body', await errorBody(missing))

  narrate.step('POST /fruits — no key → 401')
  const denied = await client.fruits.$post({
    json: {
      name: 'Mango',
      emoji: '🥭',
      color: 'orange',
      tags: ['sweet'],
      pricePerKg: 5,
      stockKg: 12,
    },
  })
  if (!denied.ok)
    narrate.expected('guard rejected the write', await errorBody(denied))

  narrate.step('POST /fruits — with key → 201')
  const created = await expectOk(
    await client.fruits.$post(
      {
        json: {
          name: 'Mango',
          emoji: '🥭',
          color: 'orange',
          tags: ['sweet', 'tropical'],
          pricePerKg: 5,
          stockKg: 12,
        },
      },
      auth,
    ),
  )
  narrate.ok('created', `${created.emoji} ${created.name}`)

  narrate.step('PATCH /fruits/:id — ripen the mango')
  const patched = await expectOk(
    await client.fruits[':id'].$patch({ param: { id: 'mango' }, json: { ripeness: 95 } }, auth),
  )
  narrate.ok('ripeness now', patched.ripeness)

  narrate.step('POST /checkout — out of stock → 409')
  const broke = await client.checkout.$post({ json: { items: [{ id: 'kiwi', kg: 9999 }] } })
  if (!broke.ok)
    narrate.expected('domain error', await errorBody(broke))

  narrate.step('POST /checkout — a real basket')
  const receipt = await expectOk(
    await client.checkout.$post({
      json: {
        items: [
          { id: 'kiwi', kg: 2 },
          { id: 'mango', kg: 1 },
        ],
      },
    }),
  )
  narrate.ok('receipt total', `$${receipt.total}`)

  narrate.step('GET /fruits/:id/ripen — Server-Sent Events')
  const ripening = await client.fruits[':id'].ripen.$get({ param: { id: 'banana' } })
  for await (const tick of readSSE(ripening)) narrate.info(`🍌 ripeness → ${tick.ripeness}`)

  narrate.step('DELETE /fruits/:id')
  const removed = await client.fruits[':id'].$delete({ param: { id: 'mango' } }, auth)
  narrate.ok('deleted mango', removed.status)

  narrate.done(`${label} complete — RPC types inferred straight from the server`)
}
