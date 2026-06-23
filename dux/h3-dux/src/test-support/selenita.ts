/**
 * The selenita project for editor-DX suites, wired once.
 *
 * The package tsconfig maps `@mszr/h3-dux` (and subpaths) onto `src/`, so
 * snippets read exactly like userland code and resolve against our real types.
 */
import { resolve } from 'node:path'
import process from 'node:process'
import { defineProject } from '@mszr/selenita'
import '@mszr/selenita/vitest'

// Resolve from cwd (the package dir under Vitest) rather than import.meta.url.
function tsconfigPath() {
  return resolve(process.cwd(), 'tsconfig.json')
}

/** Call at module scope (it registers `beforeAll`/`afterAll`). */
export function duxProject(): ReturnType<typeof defineProject> {
  return defineProject({ tsconfig: tsconfigPath() })
}
