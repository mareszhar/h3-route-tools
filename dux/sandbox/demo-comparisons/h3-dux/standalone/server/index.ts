import { PORTS } from '@orchard/domain'
import { serve } from 'srvx'
import { app } from './app.ts'

const port = Number(process.env.PORT ?? PORTS['h3-dux'])

serve({ port, fetch: app.fetch })
console.log(`🍊 h3-dux Orchard → http://localhost:${port}`)
