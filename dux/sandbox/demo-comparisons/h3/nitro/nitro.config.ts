import { defineNitroConfig } from 'nitro/config'

export default defineNitroConfig({
  compatibilityDate: 'latest',
  serverDir: './server',
  errorHandler: './server/error.ts',
  experimental: {
    asyncContext: true,
  },
})
