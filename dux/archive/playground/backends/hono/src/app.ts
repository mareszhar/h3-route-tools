import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { OrchardError } from '@orchard/domain'
import { Hono } from 'hono'
import { observability } from './middleware/observability.ts'
import { checkout } from './routes/checkout.ts'
import { fruits } from './routes/fruits.ts'
import { health } from './routes/health.ts'
import { stream } from './routes/stream.ts'

// Keep the `.route()` chain unbroken so `App` carries every endpoint into `hc`.
const app = new Hono()
  .use(observability)
  .onError((err, c) => {
    if (err instanceof OrchardError)
      return c.json(err.toBody(), err.status as ContentfulStatusCode)
    return c.json({ error: 'internal', message: 'Something bruised in the orchard 🍂' }, 500)
  })
  .notFound(c => c.json({ error: 'not_found', message: 'No route here 🤷' }, 404))
  .route('/', health)
  .route('/fruits', fruits)
  .route('/', checkout)
  .route('/', stream)

export { app }
export type App = typeof app
