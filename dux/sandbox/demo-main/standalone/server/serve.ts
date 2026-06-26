/**
 * Serve the Orchard app over HTTP for poking by hand: `bun run serve`, then e.g.
 *   curl localhost:3000/fruits
 *   curl -N localhost:3000/fruits/kiwi/ripen   # watch the SSE stream
 */
import { serve } from 'srvx'
import { app } from './app.ts'

serve({ fetch: app.fetch, port: 3000 })
console.log('🍊 Orchard (h3-dux) listening on http://localhost:3000')
