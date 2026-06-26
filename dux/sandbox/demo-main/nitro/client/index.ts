/**
 * A typed client for the Nitro app, built from the **generated** route map — no
 * hand-written `Routes` interface. The h3-dux Nitro module emits `#h3-dux/routes`
 * from the file routes' kernels on prepare/dev/build; the client is typed from it
 * exactly as the standalone client is typed from `typeof app`.
 */
import type { Routes } from '#h3-dux/routes'
import { createClient } from '@mszr/h3-dux'

export const api = createClient<Routes>({ baseURL: 'http://localhost:3000' })
// api.get('/fruits/:id', { params: { id: 'mango' } }) → typed Fruit
// api.get(`/fruits/${id}`)                              → same, interpolated
