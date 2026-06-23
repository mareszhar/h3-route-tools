import { PORTS } from '@orchard/domain'
import { serve } from 'h3'
import { app } from './app.ts'

const port = Number(process.env.PORT ?? PORTS.h3)

serve(app, { port })
console.log(`🥝 h3 Orchard → http://localhost:${port}`)
