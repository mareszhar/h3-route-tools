import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import type { H3DuxServer } from './server.ts'
import { defineHandler } from 'h3'

/**
 * Mount a programmatic dux app as a Nitro catch-all handler:
 *
 * ```ts
 * // server/routes/[...].ts  (or a config `handlers` entry)
 * import { toNitroHandler } from '@mszr/h3-dux'
 * import { app } from '../app.ts'
 * export default toNitroHandler(app)
 * ```
 *
 * It re-enters the dux app through **its own** h3 while forwarding Nitro's
 * `event.context`, and that is the whole point.
 *
 * Nitro pins h3 to an exact version (`3.0.0` → `h3@2.0.1-rc.2`); h3-dux resolves
 * its own, newer h3. When those don't dedupe, one install runs two h3 builds
 * side by side. `app.native.handler(event)` would hand Nitro's rc.2-built event
 * straight into dux's newer h3 helpers — and a helper like `handleCors` reaches
 * for response fields (`errHeaders`) that the older event never had, so the
 * request 500s at `undefined.append`. Re-dispatching by the raw `Request` makes
 * dux construct a native event from its own h3, so every dux/h3 helper sees the
 * shape it expects regardless of the version skew.
 *
 * Passing `event.context` keeps Nitro's request scope intact — Cloudflare
 * `env`/`waitUntil`, `cf`, and anything else Nitro staged — which a bare
 * `app.fetch(event.req)` would drop. The dux event shares that same context
 * object, so bindings and platform hooks survive the boundary.
 *
 * Use this whenever a dux app is mounted under Nitro; reach for `app.native`
 * only when the surrounding event is already one of dux's own.
 */
export function toNitroHandler(app: H3DuxServer<any, any>): EventHandler<EventHandlerRequest, Response | Promise<Response>> {
  return defineHandler((event: H3Event): Response | Promise<Response> =>
    app.native.request(event.req, undefined, event.context))
}
