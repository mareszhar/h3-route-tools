/**
 * Plane boundary (issue: client breaks an h3 v1 / Nitro v2 bundle). The `/client`
 * entry (`src/client.ts`) is published for consumers that only talk to a dux API —
 * including Nuxt 4 apps whose `h3` is v1. For its bundle to load in *any* h3
 * environment, nothing in its runtime graph may pull a value from `h3`; the client
 * speaks `fetch`/`Response` and its own `H3DuxHTTPError`, and depends on the server
 * only for the `App` *type* (erased). h3 as an `import type` is fine.
 *
 * This walks the entry's transitive *runtime* import graph — following value
 * imports/re-exports, skipping `import type`/`export type` (which contribute no
 * runtime code, and are how the client legitimately reaches server-side contract
 * types that themselves import h3) — and asserts no value import from `h3`.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const SRC = dirname(fileURLToPath(import.meta.url))

// Tempered token (`(?:(?!from)…)*?`) keeps the middle unambiguous — no adjacent
// whitespace quantifiers to backtrack over. Groups: 1 keyword, 2 `type ` (or not), 3 source.
const STATEMENT = /\b(import|export)\s(type\s)?(?:(?!\bfrom\b)[\s\S])*?\bfrom\s+['"]([^'"]+)['"]/g
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/.*$/gm

/** Collect value imports of `h3` reachable from `entry` through the runtime graph. */
function h3ValueImports(entry: string): string[] {
  const seen = new Set<string>()
  const offenders: string[] = []

  const visit = (file: string): void => {
    if (seen.has(file))
      return
    seen.add(file)
    let code: string
    try {
      code = readFileSync(file, 'utf8')
    }
    catch {
      return // a target that isn't a real module (e.g. a comment-example path)
    }
    code = code.replace(COMMENTS, '')
    for (const match of code.matchAll(STATEMENT)) {
      const typeOnly = Boolean(match[2])
      const source = match[3]
      if (typeOnly || !source)
        continue // erased — not in the runtime bundle
      if (source === 'h3')
        offenders.push(`${file.slice(SRC.length + 1)}: ${match[0].replace(/\s+/g, ' ').trim()}`)
      else if (source.startsWith('.'))
        visit(resolve(dirname(file), `${source.replace(/\.ts$/, '')}.ts`))
    }
  }

  visit(entry)
  return offenders
}

it('the /client entry never value-imports h3 (loads in an h3 v1 / no-h3 consumer)', () => {
  expect(h3ValueImports(resolve(SRC, 'client.ts'))).toEqual([])
})

it('the walker actually detects a value import (guards against a false green)', () => {
  // The full `.` entry does value-import h3 — proves the walk isn't a no-op.
  expect(h3ValueImports(resolve(SRC, 'index.ts')).length).toBeGreaterThan(0)
})
