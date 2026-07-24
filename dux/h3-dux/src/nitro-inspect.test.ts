/**
 * Nitro module inspection scoping (issue A). The `types:extend` collector imports
 * route modules to read their authoring form, but only the ones that could be dux
 * **file routes** — Nitro's scanned filesystem handlers. A programmatic config
 * handler (`handlers: [{ handler: './server' }]`) or a Nitro-internal route
 * (`node_modules/.../runtime/internal/routes/dev-tasks`) is never a candidate, so
 * it is never imported and never warned about. This locks that boundary: the false
 * positives from a pure `createServer()` + catch-all app do not come back.
 */
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { duxRouteCandidates, isDuxCandidate } from './nitro.ts'

const ROOT = '/project'
const TYPES = '/project/.nitro/types'

describe('duxRouteCandidates', () => {
  it('normalizes scanned handlers to extension-less absolute paths', () => {
    const candidates = duxRouteCandidates(
      [
        { handler: resolve(ROOT, 'server/routes/fruits/[id].get.ts') },
        { handler: resolve(ROOT, 'server/routes/health.get.mts') },
      ],
      ROOT,
    )
    expect(candidates.has(resolve(ROOT, 'server/routes/fruits/[id].get'))).toBe(true)
    expect(candidates.has(resolve(ROOT, 'server/routes/health.get'))).toBe(true)
  })
})

describe('isDuxCandidate', () => {
  const candidates = duxRouteCandidates(
    [{ handler: resolve(ROOT, 'server/routes/fruits/[id].get.ts') }],
    ROOT,
  )

  it('accepts a scanned file route by its generated import specifier', () => {
    // Nitro emits `import('../../server/routes/fruits/[id].get')` relative to typesDir.
    expect(isDuxCandidate('../../server/routes/fruits/[id].get', TYPES, candidates)).toBe(true)
  })

  it('rejects a programmatic config handler (the catch-all that only warned before)', () => {
    // `handlers: [{ handler: './server' }]` → `import('../../server')`; not a scanned route.
    expect(isDuxCandidate('../../server', TYPES, candidates)).toBe(false)
  })

  it('rejects a Nitro-internal route under node_modules outright', () => {
    const spec = '../../node_modules/.pnpm/nitro@3.0.0/node_modules/nitro/dist/runtime/internal/routes/dev-tasks'
    expect(isDuxCandidate(spec, TYPES, candidates)).toBe(false)
  })

  it('inspects nothing when the project has no scanned file routes', () => {
    // The pure programmatic repro: empty scan → every route in the table is a non-candidate.
    const empty = duxRouteCandidates([], ROOT)
    expect(isDuxCandidate('../../server', TYPES, empty)).toBe(false)
  })
})
