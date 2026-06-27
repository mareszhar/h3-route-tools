import { defineNitroConfig } from 'nitro/config'

export default defineNitroConfig({
  compatibilityDate: 'latest',
  srcDir: './server',
  modules: ['@mszr/h3-dux/nitro'],
})
