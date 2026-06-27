import { defineNitroConfig } from 'nitro/config'

export default defineNitroConfig({
  compatibilityDate: 'latest',
  srcDir: './server',
  errorHandler: './server/error.ts',
  experimental: {
    asyncContext: true,
  },
})
