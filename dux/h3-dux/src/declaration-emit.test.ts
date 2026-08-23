import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// ── the declaration-emit nameability guard ────────────────────────────────────
// A consumer that re-exports an inferred h3-dux type — `export const app =
// createServer(...)`, then `export type App = typeof app` for a typed client —
// must be able to run `tsc --declaration` / `--emitDeclarationOnly` over it. For
// that emit to succeed, every internal type transitively reachable in a public
// inferred shape has to be *importable by name* from the package entry, or TS
// fails with TS4023 (and its family, 2742/4058/4060) — an error the consumer
// cannot fix from their side, so it is a library-quality property, not a
// workaround.
//
// This is invisible to the package's own `tsc --noEmit`: the package compiles
// fine while a consumer's declaration emit breaks. And it only reproduces
// against the *bundled* `dist/*.d.mts` — from `src` every internal type is
// reachable through its own module path, so the re-export collapse that hides a
// name never happens. Hence the guard compiles a fixture against `dist`.
//
// Skips cleanly when the package is unbuilt so `bun run sdk:test` stays green in
// a fresh checkout; the prepublish gate builds before it tests, so the release
// path always runs this for real (see dux-spec-workspace.md §5).

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const built = existsSync(join(pkgRoot, 'dist', 'index.d.mts'))
  && existsSync(join(pkgRoot, 'dist', 'client.d.mts'))

/** The unnameable-type error family: a public inferred type reaching a name the entry doesn't export. */
const NAMEABILITY_ERRORS = /error TS(4023|2742|4058|4060)/

/** Temp dirs to remove once every fixture has compiled. */
const cleanups: Array<() => void> = []
afterAll(() => {
  for (const cleanup of cleanups) cleanup()
})

/** Resolve `h3`'s install dir so the fixture's peer types resolve exactly as a consumer's would. */
function resolveH3Dir(): string {
  return dirname(require.resolve('h3/package.json'))
}

/**
 * A consumer program that resolves `@mszr/h3-dux` and `@mszr/h3-dux/client` by
 * name (via a symlinked `node_modules`, so the real `exports` map and bundled
 * dts are exercised), then runs `tsc --emitDeclarationOnly` over it. Returns the
 * compiler output.
 */
function emitConsumer(fixtures: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'h3-dux-dts-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

  const nm = join(dir, 'node_modules')
  mkdirSync(join(nm, '@mszr'), { recursive: true })
  symlinkSync(pkgRoot, join(nm, '@mszr', 'h3-dux'), 'dir')
  symlinkSync(resolveH3Dir(), join(nm, 'h3'), 'dir')

  for (const [name, source] of Object.entries(fixtures))
    writeFileSync(join(dir, name), source)

  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      declaration: true,
      emitDeclarationOnly: true,
      skipLibCheck: true,
      outDir: 'out',
    },
    include: Object.keys(fixtures),
  }))

  // Run the package's own TypeScript with the runner's executable (bun or node),
  // so the guard needs no globally installed compiler.
  const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
  try {
    execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
    return ''
  }
  catch (error) {
    const err = error as { stdout?: string, stderr?: string }
    return `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
}

describe.skipIf(!built)('declaration emit nameability', () => {
  it('emits declarations for a re-exported server + router without TS4023', () => {
    const output = emitConsumer({
      'server.ts': [
        `import { createServer, createRouter, typedResponse } from '@mszr/h3-dux'`,
        ``,
        `export const updatesRouter = createRouter('/updates')`,
        `  .get('/:id', { handler: e => ({ id: e.params.id }) })`,
        ``,
        `export const app = createServer()`,
        `  .get('/health', { handler: () => ({ ok: true }) })`,
        `  .post('/things', { status: 201, handler: () => typedResponse({ created: true }, { status: 201 }) })`,
        `  .mount(updatesRouter)`,
        ``,
        `export type App = typeof app`,
        ``,
      ].join('\n'),
    })

    expect(output, output).not.toMatch(NAMEABILITY_ERRORS)
  })

  it('emits declarations for a client re-exported from the /client subpath', () => {
    const output = emitConsumer({
      'server.ts': [
        `import { createServer } from '@mszr/h3-dux'`,
        `export const app = createServer().get('/health', { handler: () => ({ ok: true }) })`,
        `export type App = typeof app`,
        ``,
      ].join('\n'),
      'client.ts': [
        `import { createClient } from '@mszr/h3-dux/client'`,
        `import type { App } from './server.ts'`,
        `export const api = createClient<App>({ baseURL: '/' })`,
        ``,
      ].join('\n'),
    })

    expect(output, output).not.toMatch(NAMEABILITY_ERRORS)
  })
})
