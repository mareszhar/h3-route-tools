import { app } from '@orchard/backend-elysia'
import { defineHandler } from 'h3'

// Catch-all route: hand every request to the modular Elysia app and return its
// response verbatim (so the app's own 404s/errors are preserved).
export default defineHandler(event => app.fetch(event.req))
