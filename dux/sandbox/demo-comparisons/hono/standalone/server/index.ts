import { PORTS } from '@orchard/domain'
import { app } from './app.ts'

const port = Number(process.env.PORT ?? PORTS.hono)

console.log(`🍯 Hono Orchard → http://localhost:${port}`)

export default { port, fetch: app.fetch }
