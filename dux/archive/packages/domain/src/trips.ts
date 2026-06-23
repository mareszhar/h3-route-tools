import type { OrchardClient } from './client.ts'
import { narrate } from './narrate.ts'

const mango = {
  name: 'Mango',
  emoji: '🥭',
  color: 'orange',
  tags: ['sweet', 'tropical'],
  pricePerKg: 5,
  stockKg: 12,
}

/**
 * The narrated "shopping trip" shared by the fetch-based clients (h3 + Nitro-h3),
 * exercising every endpoint — including a deliberate 401, 404 and 409.
 * `api` carries the write key; `deniedApi` does not.
 */
export async function runFetchTrip(
  label: string,
  api: OrchardClient,
  deniedApi: OrchardClient,
): Promise<void> {
  narrate.banner(label)

  narrate.step('GET /health')
  const health = await api.health()
  if (health.ok)
    narrate.ok('orchard is', health.data.status)

  narrate.step('GET /fruits — filter + sort + cursor pagination')
  const page1 = await api.listFruits({ sort: 'price', limit: 2 })
  if (page1.ok) {
    narrate.ok(
      'page 1',
      page1.data.items.map(f => f.emoji),
    )
    const page2 = await api.listFruits({
      sort: 'price',
      limit: 2,
      cursor: page1.data.nextCursor ?? undefined,
    })
    if (page2.ok) {
      narrate.ok(
        'page 2',
        page2.data.items.map(f => f.emoji),
      )
    }
  }

  narrate.step('GET /fruits/:id')
  const apple = await api.getFruit('apple')
  if (apple.ok)
    narrate.ok('fetched', `${apple.data.emoji} ${apple.data.name}`)

  narrate.step('GET /fruits/:id — missing → 404')
  const missing = await api.getFruit('dragonfruit')
  if (!missing.ok)
    narrate.expected('error body', missing.error)

  narrate.step('POST /fruits — no key → 401')
  const denied = await deniedApi.createFruit(mango)
  if (!denied.ok)
    narrate.expected('guard rejected the write', denied.error)

  narrate.step('POST /fruits — with key → 201')
  const created = await api.createFruit(mango)
  if (created.ok)
    narrate.ok('created', `${created.data.emoji} ${created.data.name} (${created.status})`)

  narrate.step('PATCH /fruits/:id — ripen the mango')
  const patched = await api.updateFruit('mango', { ripeness: 95 })
  if (patched.ok)
    narrate.ok('ripeness now', patched.data.ripeness)

  narrate.step('POST /checkout — out of stock → 409')
  const broke = await api.checkout({ items: [{ id: 'kiwi', kg: 9999 }] })
  if (!broke.ok)
    narrate.expected('domain error', broke.error)

  narrate.step('POST /checkout — a real basket')
  const receipt = await api.checkout({
    items: [
      { id: 'kiwi', kg: 2 },
      { id: 'mango', kg: 1 },
    ],
  })
  if (receipt.ok)
    narrate.ok('receipt total', `$${receipt.data.total}`)

  narrate.step('GET /fruits/:id/ripen — Server-Sent Events')
  for await (const tick of api.ripen('banana')) narrate.info(`🍌 ripeness → ${tick.ripeness}`)

  narrate.step('DELETE /fruits/:id')
  const removed = await api.removeFruit('mango')
  narrate.ok('deleted mango', removed.status)

  narrate.done(`${label} complete — typed end-to-end through shared valibot schemas`)
}
