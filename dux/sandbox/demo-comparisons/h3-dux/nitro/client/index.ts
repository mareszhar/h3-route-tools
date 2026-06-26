import type { Routes } from '#h3-dux/routes'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@mszr/h3-dux'
import { narrate, ORCHARD_KEY, ORCHARD_KEY_HEADER } from '@orchard/domain'

const here = dirname(fileURLToPath(import.meta.url))
const backendDir = resolve(here, '../..')
const serverEntry = resolve(backendDir, '.output/server/index.mjs')
const port = 3977
const baseURL = `http://localhost:${port}`
const api = createClient<Routes>({ baseURL })
const auth = { headers: { [ORCHARD_KEY_HEADER]: ORCHARD_KEY } }

if (!existsSync(serverEntry)) {
  narrate.info('No build found — running `nitro build` (one-time)…')
  const build = Bun.spawnSync(['bun', 'run', 'build'], {
    cwd: backendDir,
    stdout: 'ignore',
    stderr: 'inherit',
  })
  if (build.exitCode !== 0)
    throw new Error('nitro build failed')
}

narrate.info(`Spawning h3-dux Nitro server on ${baseURL}…`)
const server = Bun.spawn(['node', serverEntry], {
  cwd: backendDir,
  env: { ...process.env, PORT: String(port) },
  stdout: 'ignore',
  stderr: 'ignore',
})

async function waitForReady(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseURL}/health`)).ok)
        return
    }
    catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('Nitro server did not become ready in time')
}

try {
  await waitForReady()
  narrate.banner('Nitro (h3-dux file-routing) · honest client shopping trip')

  narrate.step('GET /health')
  narrate.ok('orchard is', (await api.get('/health').orThrow()).status)

  narrate.step('GET /fruits — filter + sort + cursor pagination')
  const page1 = await api.get('/fruits', { query: { sort: 'price', limit: 2 } }).orThrow()
  narrate.ok('page 1', page1.items.map(f => f.emoji))
  const page2 = await api.get('/fruits', {
    query: { sort: 'price', limit: 2, cursor: page1.nextCursor ?? undefined },
  }).orThrow()
  narrate.ok('page 2', page2.items.map(f => f.emoji))

  narrate.step('GET /fruits/:id')
  const apple = await api.get('/fruits/:id', { params: { id: 'apple' } }).orThrow()
  narrate.ok('fetched', `${apple.emoji} ${apple.name}`)

  narrate.step('GET /fruits/:id — missing → typed 404')
  const missing = await api.get('/fruits/:id', { params: { id: 'dragonfruit' } })
  if (missing.error?.kind === 'http')
    narrate.expected('error body', missing.error.data)

  narrate.step('POST /fruits — no key → typed 401')
  const denied = await api.post('/fruits', {
    body: {
      name: 'Mango',
      emoji: '🥭',
      color: 'orange',
      tags: ['sweet'],
      pricePerKg: 5,
      stockKg: 12,
    },
  })
  if (denied.error?.kind === 'http')
    narrate.expected('guard rejected the write', denied.error.data)

  narrate.step('POST /fruits — with key → 201')
  const created = await api.post('/fruits', {
    ...auth,
    body: {
      name: 'Mango',
      emoji: '🥭',
      color: 'orange',
      tags: ['sweet', 'tropical'],
      pricePerKg: 5,
      stockKg: 12,
    },
  }).orThrow()
  narrate.ok('created', `${created.emoji} ${created.name}`)

  narrate.step('PATCH /fruits/:id — ripen the mango')
  const patched = await api.patch('/fruits/:id', {
    ...auth,
    params: { id: 'mango' },
    body: { ripeness: 95 },
  }).orThrow()
  narrate.ok('ripeness now', patched.ripeness)

  narrate.step('POST /checkout — out of stock → typed 409')
  const broke = await api.post('/checkout', { body: { items: [{ id: 'kiwi', kg: 9999 }] } })
  if (broke.error?.kind === 'http')
    narrate.expected('domain error', broke.error.data)

  narrate.step('POST /checkout — a real basket')
  const receipt = await api.post('/checkout', {
    body: {
      items: [
        { id: 'kiwi', kg: 2 },
        { id: 'mango', kg: 1 },
      ],
    },
  }).orThrow()
  narrate.ok('receipt total', `$${receipt.total}`)

  narrate.step('GET /fruits/:id/ripen — Server-Sent Events')
  for await (const tick of api.get('/fruits/:id/ripen', { params: { id: 'banana' } }))
    narrate.info(`🍌 ripeness → ${tick.ripeness}`)

  narrate.step('DELETE /fruits/:id')
  const removed = await api.delete('/fruits/:id', { ...auth, params: { id: 'mango' } }).raw()
  narrate.ok('deleted mango', removed.status)

  narrate.done('h3-dux Nitro trip complete — route types came from #h3-dux/routes')
}
finally {
  server.kill()
}

process.exit(0)
