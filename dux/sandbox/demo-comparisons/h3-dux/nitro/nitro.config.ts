import { defineNitroConfig } from 'nitro/config'

export default defineNitroConfig({
  compatibilityDate: 'latest',
  serverDir: './server',
  modules: ['@mszr/h3-dux/nitro'],
})
