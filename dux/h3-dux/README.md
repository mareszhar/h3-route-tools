# @mszr/h3-dux

**End-to-end type-safe routes for [h3](https://h3.dev) v2 and [Nitro](https://nitro.build) v3 — DX first.**

h3-dux is a DX/UX-first layer over [`h3-route-tools`](https://github.com/sandros94/h3-route-tools). It keeps
everything that already makes h3-route-tools great — an accumulating typed route builder whose `typeof app` is
the single source of truth, [Standard Schema](https://standardschema.dev) validation, a
[fetchdts](https://github.com/unjs/fetchdts)-style typed client, Nitro file-based codegen, and OpenAPI — and
reshapes the authoring surface around one question: *what would feel most delightful to use?*

## Highlights

🪞 **Server and client read as counterparts** — `createServer()` builds the routes; `createClient<typeof app>()`
consumes them. Same verbs on both sides (`app.get` ↔ `api.get`), so a route and its call site mirror each other.

🎯 **Responses are inferred, not asserted** — the handler's return *is* the client's type. No `request<Receipt>(…)`
to drift out of sync. Opt into runtime response validation by declaring `validate.response`.

🔗 **Path params, both ways** — interpolate (`api.get(\`/fruits/${id}\`)`) or key them (`{ params: { id } }`),
whichever reads best at the call site.

📡 **Typed SSE** — `sse(schema)` makes a streaming endpoint return an `AsyncGenerator<T>` on the client, not a
hand-parsed `text/event-stream`.

🚦 **Validation you control** — eager and sequential by default (params → query → body, short-circuit); flip
`eager: false` for deliberate, on-demand validation via `event.valid('body')`.

🔓 **Auth is not a concept here** — a protected route is `middleware: [...]`; an authenticated call is a header.
Nothing app-specific leaks into the kit.

## Install

```bash
npm install @mszr/h3-dux h3
```

`h3` is the one required peer. `nitro` and `srvx` are optional peers — add them only for the entrypoint you use.

## The shape

One package, three entrypoints. The root is the standalone server + client; the others mirror upstream.

| Entrypoint | What it is |
|---|---|
| `@mszr/h3-dux` | `createServer`, `createClient`, `defineRoute`, `sse`, schema/validation helpers, the typed-fetch types |
| `@mszr/h3-dux/nitro` | the Nitro module for file-based routes (`modules: ['@mszr/h3-dux/nitro']`) |
| `@mszr/h3-dux/codegen` | the route-types / OpenAPI codegen used by the Nitro module and CLI |

## A taste

```ts
// server.ts — the routes are the schema
import { createServer } from '@mszr/h3-dux'
import * as v from 'valibot'

export const app = createServer()
  .route({
    route: '/fruits/:id',
    params: v.object({ id: v.string() }),
    get: { handler: e => orchard.get(e.context.params.id) }, // response inferred → Fruit
  })

export type App = typeof app
```

```ts
// client.ts — typed end-to-end from `typeof app`, never hand-typed
import { createClient } from '@mszr/h3-dux'
import type { App } from './server'

const api = createClient<App>({ baseURL })
const res = await api('/fruits/:id', { method: 'get', params: { id: 'mango' } })
const fruit = await res.json() // typed: Fruit (wire shape)
```

## The one hard contract

**h3-dux owes behavioral compatibility to h3 and Nitro, not API compatibility to any SDK.** Everything it emits is
something h3/Nitro already understand, and it tracks upstream `h3-route-tools` closely so improvements flow both
ways. Inside that envelope, the ergonomics are ours to reimagine.

## Status

Today h3-dux re-exports the **entire** `h3-route-tools` surface plus the `createServer` / `createClient` counterpart
names. The DX deltas — per-verb authoring, client verb sugar, path interpolation, typed SSE, and validation modes —
are specified and on the roadmap. See [the spec](../docs/dux-spec.md) for each contract and its status.

## Development

This published package is the front door, not the workspace. Build, lint, test, and release commands live in the
dux maintainer workspace one level up — see [`dux/`](..) and its [README](../README.md).

## Docs

- [dux-vision.md](../docs/dux-vision.md) — what h3-dux is, why a fork, the principles, the roadmap
- [dux-conventions.md](../docs/dux-conventions.md) — vocabulary, the fetchdts alignment, the naming map
- [dux-spec.md](../docs/dux-spec.md) — the deltas, contract by contract
- [dux-spec-workspace.md](../docs/dux-spec-workspace.md) — how the workspace is built, tested, and shipped
