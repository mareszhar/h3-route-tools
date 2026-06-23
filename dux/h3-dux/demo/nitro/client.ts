/**
 * A typed client for the Nitro app, built from a **type-only** route map (no
 * runtime import of the route files — zero client-bundle cost). The same
 * `createClient` as the standalone demo; the routes just come from `typeof
 * import(...)` instead of `typeof app`.
 */
import { createClient } from '@mszr/h3-dux'

interface Routes {
  '/health': typeof import('./routes/health.get').default
  '/fruits': typeof import('./routes/fruits/index.get').default
  '/fruits/:id': typeof import('./routes/fruits/[id].get').default
}

export const api = createClient<Routes>({ baseURL: 'http://localhost:3000' })
// api.get('/fruits/:id', { params: { id: 'mango' } }) → typed Fruit
// api.get(`/fruits/${id}`)                              → same, interpolated
