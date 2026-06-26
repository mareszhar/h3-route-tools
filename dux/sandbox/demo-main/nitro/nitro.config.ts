import { defineConfig } from 'nitro'

// The h3-dux Nitro module (re-exported from upstream) types nitro's InternalApi
// from each route file's contract, and enriches the OpenAPI document.
export default defineConfig({
  modules: ['@mszr/h3-dux/nitro'],
  serverDir: './server',
  compatibilityDate: '2026-06-23',
  experimental: { openAPI: true },
  typescript: {
    generatedTypesDir: '.nitro/types',
    generateTsConfig: true,
    tsConfig: {
      compilerOptions: {
        noEmit: true,
      },
    },
  },
})
