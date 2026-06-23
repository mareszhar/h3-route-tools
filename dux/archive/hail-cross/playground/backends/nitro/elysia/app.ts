// Re-export the modular Elysia app so the Nitro-Elysia client can infer types
// for Eden Treaty. Nitro is purely the runtime; the app is the standalone one.
export { app } from "@orchard/backend-elysia";
export type { App } from "@orchard/backend-elysia";
