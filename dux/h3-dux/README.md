# @mszr/h3-dux

**End-to-end type-safe routes for [h3](https://h3.dev) v2 and [Nitro](https://nitro.build) v3 — DX first.**

h3-dux is a DX/UX-first layer over [`h3-route-tools`](https://github.com/sandros94/h3-route-tools). It keeps everything that already makes h3-route-tools great — an accumulating typed route builder whose `typeof app` is the single source of truth, [Standard Schema](https://standardschema.dev) validation, a [fetchdts](https://github.com/unjs/fetchdts)-style typed client, Nitro file-based codegen, and OpenAPI — and reshapes the authoring surface around one question: *what would feel most delightful to use?*

## Highlights

🪞 **Server and client read as counterparts** — `createServer()` builds the routes; `createClient<typeof app>()` consumes them. Same verbs on both sides (`app.get` ↔ `api.get`), so a route and its call site mirror each other.

🎯 **Responses are inferred, not asserted** — the handler's return *is* the client's type. No `request<Receipt>(…)` to drift out of sync. Opt into runtime response validation by declaring `validate.response`.

🧭 **Honest by default** — a call resolves to `{ data, error }`, so a failure is handled at the cursor, not surfaced later as a throw. `.orThrow()` bubbles it; `.raw()` hands you the native `Response` with a kind-aware `.parse()`. The `error` is discriminated and typed per status.

🔗 **Path params, both ways** — interpolate (`api.get(\`/fruits/${id}\`)`) or key them (`{ params: { id } }`), whichever reads best at the call site.

📡 **Typed SSE** — `sse(schema)` makes a streaming endpoint return an `AsyncGenerator<T>` on the client, not a hand-parsed `text/event-stream`.

🧱 **Response kinds, inferred** — return a string, Blob, empty value, or object and the client receives `string`, `Blob`, `undefined`, or JSON automatically. `sse()` adds streams; `typedResponse()` keeps native Response bodies typed.

🚦 **Validation you control** — eager and sequential by default (params → query → body, short-circuit); flip `eager: false` for deliberate, on-demand validation via `event.valid('body')`.

🧩 **Composition that carries the deltas** — split a domain into `createRouter('/fruits').get(…)` and `createServer().mount(router)`; the prefix infers child params and the client still sees one flat map. Duplicate route+method is a cursor error, not silent first-wins.

🪪 **Typed middleware bindings** — `defineMiddleware({ bindings })` publishes request-scoped values that downstream handlers read as `event.bindings`, fully typed. `requires` consumes a parent capability without re-registering it; `.mount` checks it.

📁 **Nitro file routes, fully typed** — `defineFileRoute` carries every delta into a filesystem route (the filename owns the path/method); `createFileRouteFactory().use(…)` carries middleware capabilities across files. The Nitro module generates `#h3-dux/routes`, so `createClient<Routes>()` is typed end-to-end with **no hand-written route interface**.

## Install

```bash
npm install @mszr/h3-dux h3
```

`h3` is the one required peer. `nitro` and `srvx` are optional peers — add them only for the entrypoint you use.

## The shape

One package, three entrypoints. The root is the standalone server + client; the others mirror upstream.

| Entrypoint | What it is |
| --- | --- |
| `@mszr/h3-dux` | `createServer`, `createClient`, `typedResponse`, `defineRoute`, `sse`, schema/validation helpers, the typed-fetch types |
| `@mszr/h3-dux/nitro` | the Nitro module for file-based routes (`modules: ['@mszr/h3-dux/nitro']`) |
| `@mszr/h3-dux/codegen` | the route-types / OpenAPI codegen used by the Nitro module and CLI |

## A taste

```ts
// server.ts — the routes are the schema
import { createServer, sse } from '@mszr/h3-dux'
import { ConflictSchema, NewFruitSchema, RipenTickSchema } from '@orchard/domain'

export const app = createServer()
  // No options needed → pass the handler directly. `:id` typed from the pattern,
  // response inferred from the return — zero ceremony.
  .get('/fruits/:id', e => orchard.get(e.context.params.id))
  // validate.body → e.context.body is typed AND validated; status sets the success code.
  // errors → a typed failure channel; e.error(409, …) is checked against the schema.
  .post('/fruits', {
    status: 201,
    validate: { body: NewFruitSchema },
    errors: { 409: ConflictSchema },
    handler: (e) => {
      if (orchard.has(e.context.body.name))
        throw e.error(409, { reason: 'already_exists' })
      return orchard.create(e.context.body)
    },
  })
  // sse() makes this a typed stream on the client.
  .get('/fruits/:id/ripen', {
    validate: { response: sse(RipenTickSchema) },
    handler: async function* (e) {
      for (const tick of orchard.ripen(e.context.params.id)) yield tick
    },
  })

export type App = typeof app
```

```ts
// client.ts — typed end-to-end from `typeof app`, never hand-typed
import { createClient } from '@mszr/h3-dux'
import type { App } from './server'

const api = createClient<App>({ baseURL })

const { data } = await api.get(`/fruits/${id}`) // data: Fruit (wire shape) | undefined

// The error is the real class, typed per status — narrow it at the cursor:
const { error } = await api.post('/fruits', { body: mango })
if (error?.status === 409)
  error.data // Conflict — narrowed by status from the typed H3DuxHTTPError union
const created = await api.post('/fruits', { body: mango }).orThrow() // or bubble it

for await (const tick of api.get(`/fruits/${id}/ripen`)) // typed AsyncGenerator<RipenTick>
  console.log(tick.ripeness)
```

## The one hard contract

**h3-dux owes behavioral compatibility to h3 and Nitro, not API compatibility to any SDK.** Everything it emits is something h3/Nitro already understand, and it tracks upstream `h3-route-tools` closely so improvements flow both ways. Inside that envelope, the ergonomics are ours to reimagine.

## Status

**Generation 1** — all five DX deltas are implemented and tested (runtime, type, and editor-DX planes): per-verb server authoring (with response + param inference), client verb sugar, path interpolation, typed SSE, and eager/manual validation modes. h3-dux also re-exports the **entire** `h3-route-tools` surface unchanged.

**Generation 2** — complete (deltas 6–14, all test planes): a normalized contract kernel, an honest `{ data, error }` client whose typed `error` is the real `H3DuxHTTPError<Status, Data>` / `H3DuxTransportError` (narrowed per status, never a structural look-alike), response kinds (`text`/`binary`/`empty`/`sse`) with a hardened SSE parser, **delta-aware composition** (`createRouter`/`.mount`/`.register`, prefix param inference, duplicate-route diagnostics), **typed middleware bindings** (`defineMiddleware`, `event.bindings`/`staged`, `requires`, root event accessors), the **Nitro file-routing moat** — `defineFileRoute` (flat + method-map), capability-carrying `createFileRouteFactory` (`.use`/`.requires`/`.compose`), and a generated `#h3-dux/routes` map that types `createClient<Routes>()` with no hand-written route interface — plus **dux-aware OpenAPI** for standalone and Nitro and a polished client transport (`signal`/timeout/retry/query serialization, request/response hooks). The contract kernel is canonical: `typeof app` and `#h3-dux/routes` produce the same `{ request, responses, success }` shape, read by one client. The inferred types are tuned to read at least as cleanly as Hono's — a serialized body hovers as `{ id: string; … }`, the result as the inline `{ data, error }` — with strictly more information (honest, per-status failure).

## Development

This published package is the front door. The maintainer workspace, design docs, and runnable sandbox demos live in the `dux/` folder of the development fork.

## Docs

- [Development fork](https://github.com/mareszhar/h3-route-tools/tree/dux/dux) — maintainer workspace, design docs, and sandbox demos
