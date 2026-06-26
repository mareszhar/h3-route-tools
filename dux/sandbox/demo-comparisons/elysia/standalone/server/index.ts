import { PORTS } from '@orchard/domain'
import { app } from './app.ts'

const port = Number(process.env.PORT ?? PORTS.elysia)

app.listen(port, () => console.log(`🍎 Elysia Orchard → http://localhost:${port}`))
