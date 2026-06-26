// Re-export the modular Hono app so the Nitro-Hono client can infer its types.
// Nitro is purely the runtime here; the app itself is the standalone one.
export { app } from '@orchard/backend-hono'
export type { App } from '@orchard/backend-hono'
