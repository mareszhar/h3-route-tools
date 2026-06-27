# @mszr/h3-dux

**A DX-first h3 v2 and Nitro v3 route kit with honest typed clients, validation, streaming, and OpenAPI docs.**

h3-dux was inspired by [h3-route-tools](https://github.com/sandros94/h3-route-tools), then reimagined around one question: *what would feel most delightful to use?* It keeps h3 and Nitro as the runtime foundation while making route authoring, client calls, validation, errors, file routes, and docs feel like one coherent system.

## Highlights

💞 **Server and client read as counterparts** — `createServer()` builds the routes; `createClient<typeof app>()` consumes them. Same verbs on both sides (`app.get` ↔ `api.get`), so the route and the call site mirror each other.

💫 **Responses are inferred, not asserted** — the handler's return is the client's type. No `request<Receipt>(...)` to drift out of sync. Add `validate.response` only when you want runtime response validation too.

😇 **Honest by default** — a call resolves to `{ data, error }`, so transport failures and non-2xx responses are visible at the cursor. `.orThrow()` is the deliberate opt-out; `.raw()` gives you the native `Response` plus kind-aware `.parse()`.

👻 **Typed errors, narrowed by status** — declare `errors: { 409: ConflictSchema }`, throw with `event.error(409, data)`, and the client sees `error.data` narrowed by `error.status`.

⛰️ **Path params, both ways** — interpolated params are automatically detected, or pass them explicitly in a plain object, whichever reads best at the call site.

🤖 **Validation you control** — eager and sequential by default; flip `validate.eager` to `false` for deliberate, on-demand validation, like `event.valid('body')`.

🫀 **Response kinds are part of the contract** — JSON, text, empty, binary, and `sse()` streams decode to the right client type. `typedResponse()` keeps native `Response` bodies typed when you need the platform object.

🧩 **Composition that scales** — split domains with `createRouter('/fruits')`, mount them into a server, and the client still sees one flat route map. Duplicate route+method definitions fail at the cursor.

🤝 **Typed middleware bindings** — `defineMiddleware({ bindings })` publishes request-scoped capabilities to downstream handlers as `event.bindings`; `requires` consumes parent capabilities without re-running providers.

📂 **Nitro file routes with no hand-written route map** — `defineFileRoute` carries the same validation, response, error, middleware, and streaming model into filesystem routes. The Nitro module generates `#h3-dux/routes`, so `createClient<Routes>()` is typed from the files.

🌱 **OpenAPI documentation for free** — standalone apps and Nitro file routes document the same statuses, validation envelopes, response kinds, errors, and metadata.

## Install

```bash
npm install @mszr/h3-dux h3
```

`h3` is the required peer. `nitro` is optional and needed only when importing `@mszr/h3-dux/nitro`; `typescript` is optional and needed only for codegen helpers.

## The Shape

One package, three entrypoints. The root is the runtime authoring and client surface; Nitro and codegen stay in explicit subpaths.

| Entrypoint | What it is |
| --- | --- |
| `@mszr/h3-dux` | `createServer`, `createRouter`, `createClient`, `defineFileRoute`, `defineMiddleware`, `typedResponse`, `sse`, validation/error helpers, response-kind helpers, typed-fetch types |
| `@mszr/h3-dux/nitro` | the Nitro module for generated file-route types and OpenAPI overlay |
| `@mszr/h3-dux/codegen` | route declaration and OpenAPI file writers for build tooling |

The client/server surface is schema-library neutral through [Standard Schema](https://standardschema.dev), so Valibot, Zod, and other compatible validators can feed the same contract.

## A Taste

```ts
// server.ts
import { createServer, sse } from '@mszr/h3-dux'
import { ConflictSchema, FruitSchema, NewFruitSchema, RipenTickSchema } from '@orchard/domain'

export const app = createServer()
  .get('/fruits/:id', {
    validate: { response: FruitSchema },
    handler: event => orchard.get(event.params.id),
  })
  .post('/fruits', {
    status: 201,
    validate: {
      body: NewFruitSchema,
      response: FruitSchema,
    },
    errors: {
      409: ConflictSchema,
    },
    handler: (event) => {
      if (orchard.has(event.body.name))
        throw event.error(409, { reason: 'already_exists' })

      return orchard.create(event.body)
    },
  })
  .get('/fruits/:id/ripen', {
    validate: { response: sse(RipenTickSchema) },
    handler: async function* (event) {
      for (const tick of orchard.ripen(event.params.id))
        yield tick
    },
  })

export type App = typeof app
```

```ts
// client.ts
import { createClient } from '@mszr/h3-dux'
import type { App } from './server'

const api = createClient<App>({ baseURL })

const { data, error } = await api.get(`/fruits/${id}`)

if (error?.status === 404)
  error.data // narrowed to the 404/error body when that status is declared

if (data)
  data.name // Fruit wire shape

const created = await api.post('/fruits', { body: mango }).orThrow()

for await (const tick of api.get(`/fruits/${id}/ripen`))
  console.log(tick.ripeness)
```

## Nitro File Routes

```ts
// server/routes/fruits/[id].get.ts
import { defineFileRoute } from '@mszr/h3-dux'
import { FruitSchema } from '@orchard/domain'

export default defineFileRoute({
  validate: { response: FruitSchema },
  handler: event => orchard.get(event.params.id),
})
```

```ts
// nitro.config.ts
export default defineNitroConfig({
  modules: ['@mszr/h3-dux/nitro'],
})
```

```ts
// app/api.ts
import { createClient } from '@mszr/h3-dux'
import type { Routes } from '#h3-dux/routes'

export const api = createClient<Routes>({ baseURL: '/api' })
```

The filename owns the path and method; h3-dux owns the contract projected from the route definition. No hand-written `Routes` interface.

## Get Started

> Check out our minimal demo! ([public link](https://github.com/mareszhar/h3-route-tools/tree/dux/dux/sandbox/demo-main) | [local fork path](../sandbox/demo-main))
>
> It provides usage examples for all the main features of h3-dux ^-^ 💜

## Existing h3 Utilities

Concrete h3-dux handler events keep the native h3 event surface, so ordinary helpers that accept `H3Event` keep working when the route's `context.params` stays in h3's string-shaped model:

```ts
import { createServer } from '@mszr/h3-dux'
import type { H3Event } from 'h3'

function readSession(event: H3Event) {
  return event.req.headers.get('authorization')
}

createServer().get('/me', event => readSession(event))
```

Use `H3DuxEvent` when a helper wants dux additions such as `event.error`, `event.bindings`, `event.params`, `event.query`, or `event.body`:

```ts
import type { H3DuxEvent } from '@mszr/h3-dux'

function requireUser(event: H3DuxEvent<{ user: User }>) {
  return event.bindings.user
}
```

For helpers shared by plain h3 and h3-dux, prefer the narrow structural surface the helper actually reads. That avoids coupling the utility to either framework's full event type:

```ts
import type { H3Event } from 'h3'

type EventWithRequest = Pick<H3Event, 'req' | 'url'>

function authHeader(event: EventWithRequest) {
  return event.req.headers.get('authorization')
}
```

If the shared helper needs `context.params`, widen only that slot:

```ts
import type { H3Event } from 'h3'

type EventWithParams = Omit<H3Event, 'context'> & {
  context: Omit<H3Event['context'], 'params'> & {
    params?: Record<string, unknown>
  }
}
```

That shape accepts plain h3 params (`Record<string, string>`) and h3-dux routes whose params schema coerces values.

## The One Hard Contract

**h3-dux owes behavioral compatibility to h3 and Nitro, not API compatibility to any SDK.** Everything it emits is something h3/Nitro already understand. Inside that envelope, h3-dux is free to make the authoring and client experience more delightful.

## Development

The public `h3-dux` repo is the package face. Design docs, maintainer scripts, and sandbox comparisons live in the dux workspace inside the h3-route-tools fork ([public link](https://github.com/mareszhar/h3-route-tools/tree/dux/dux) | [local fork path](..)).

## Docs

- `dux-vision.md` ([public link](https://github.com/mareszhar/h3-route-tools/blob/dux/dux/docs/dux-vision.md) | [local fork path](../docs/dux-vision.md)) — philosophy, principles, architecture, scope
- `dux-language.md` ([public link](https://github.com/mareszhar/h3-route-tools/blob/dux/dux/docs/dux-language.md) | [local fork path](../docs/dux-language.md)) — vocabulary, naming rules, doc style
- `dux-patterns.md` ([public link](https://github.com/mareszhar/h3-route-tools/blob/dux/dux/docs/dux-patterns.md) | [local fork path](../docs/dux-patterns.md)) — validated data, honest client, errors, composition, middleware bindings
- `dux-spec.md` ([public link](https://github.com/mareszhar/h3-route-tools/blob/dux/dux/docs/dux-spec.md) | [local fork path](../docs/dux-spec.md)) — shipped behavior by delta
