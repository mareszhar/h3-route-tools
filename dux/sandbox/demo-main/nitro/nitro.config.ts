import { defineNitroConfig } from 'nitro/config'

// The h3-dux Nitro module types nitro's InternalApi from each route file's
// contract, and enriches the OpenAPI document.
export default defineNitroConfig({
  modules: ['@mszr/h3-dux/nitro'],
  srcDir: './server',
  compatibilityDate: '2026-06-23',
  experimental: { openAPI: true },
  typescript: {
    generateTsConfig: true,
    tsconfigPath: 'types/tsconfig.json',
    tsConfig: {
      compilerOptions: {
        noEmit: true,
      },
    },
  },
})
