import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

function local(path: string) {
  return fileURLToPath(new URL(path, import.meta.url))
}

export default defineConfig({
  resolve: {
    alias: {
      // Tests import the package exactly the way userland does; the tsconfig
      // `paths` carry the same mapping for the type/editor-DX planes.
      '@test': local('./src/test-support/index.ts'),
      '@mszr/h3-dux/nitro': local('./src/nitro.ts'),
      '@mszr/h3-dux/codegen': local('./src/codegen.ts'),
      '@mszr/h3-dux': local('./src/index.ts'),
      // Resolve the upstream we build on to the fork source at runtime too, so
      // tests exercise our actual upstream (not whatever npm has). Subpaths
      // first — Vite alias matches by prefix, first hit wins.
      'h3-route-tools/nitro': local('../../src/nitro.ts'),
      'h3-route-tools/codegen': local('../../src/codegen.ts'),
      'h3-route-tools': local('../../src/index.ts'),
    },
  },
  test: {
    globals: true,
    // Selenita spins up a TypeScript language service for the editor-DX suites;
    // CI runners can exceed Vitest's default budgets.
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // Runtime (*.test.ts) and editor-DX (*.dx.test.ts) planes both match this.
    include: ['src/**/*.test.ts'],
    typecheck: {
      // The type-shape plane, run via --typecheck (wired into the test scripts).
      include: ['src/**/*.test-d.ts'],
    },
  },
})
