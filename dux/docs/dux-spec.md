# h3-dux — spec

The five deltas that make h3-dux more than a rename. Each is **contract-driven**: it headlines the desired behavior and why, shows the intended usage, then proposes an implementation. The contract is the commitment; the proposed approach can move if reality teaches a better one.

Everything not listed here is inherited from `h3-route-tools` and re-exported unchanged — see [dux-vision.md §4.3](./dux-vision.md#43-inherited-vs-ours). Vocabulary, the validated-data model, and the naming map are defined once in [dux-conventions.md](./dux-conventions.md) and referenced, not repeated.

Snippets use valibot schemas from the Orchard reference (`@orchard/domain`, mirrored in [`archive/`](../archive)) so the examples are concrete.

## Implementation status

| # | Delta | Where (in `h3-dux/src/`) | Status |
| --- | --- | --- | --- |
| 1 | Per-verb server authoring (+ response & param inference) | `server.ts`, `internal/route-types.ts` | ☑ done |
| 2 | Per-verb client sugar | `client.ts` | ☑ done |
| 3 | Path-param interpolation | `client.ts` | ☑ done |
| 4 | Typed SSE | `sse.ts`, `server.ts`, `client.ts` | ☑ done |
| 5 | Validation modes (`event.context` + `event.valid`) | `server.ts`, `internal/route-types.ts` | ☑ done |

## Roadmap

| Phase | Deliverable | Status |
| --- | --- | --- |
| 0 | Workspace + scaffold: package re-exports upstream + `createServer`/`createClient`; docs | ☑ done |
| 1 | Client verb sugar (2) + path interpolation (3) | ☑ done |
| 2 | Server verb authoring (1) — `app.get`, accumulation preserved, response + param inference | ☑ done |
| 3 | Validation modes (5) — eager default + `eager: false` manual | ☑ done |
| 4 | Typed SSE (4) — `sse()` brand + client `AsyncGenerator` return | ☑ done |

Every delta ships with three test planes (runtime `*.test.ts`, type `*.test-d.ts`, editor-DX `*.dx.test.ts`), driven by the shared Orchard fixture in `src/test-support/`.

## How it landed (the realities)

The contracts below are intact; a few implementation decisions are worth recording because they shaped the code:

- **`createServer` is a wrapper, not an `H3` subclass.** h3's `H3` already owns `app.get(path, handler)`, so a subclass would clash. `DuxServer` holds an inner `H3Typed` (exposed as `app`), delegates each verb to `.route(...)`, and exposes `fetch`/`request`/`use`. `createClient` reads its accumulated routes off a phantom `'~duxRoutes'` marker (falling back to upstream's `NormalizeRoutes`).
- **A small slice of upstream's per-method types is vendored** (`internal/route-types.ts`, `internal/serialize.ts`) because they aren't public exports — the same vendor-and-mark tier the workspace spec describes.
- **Two inferences came for free and are now first-class** (delta 1): response inference (a method with no `validate.response` contributes the handler's return to the contract) and param inference (`:params` typed from the pattern, no schema needed). Both are detailed in [§6](#6-response--param-inference).
- **SSE uses a `DuxCall` handle** (delta 4): the verb methods return a value that is `await`-able (JSON path) and `for await`-able (SSE path); the type picks which, and only the consumed path fetches.

---

## 1. Per-verb server authoring

**Why.** Authoring a single-method route as `.route({ route: '/x', get: { handler } })` buries the HTTP verb inside an object key. A verb method (`app.get('/x', { handler })`) reads like the route it defines and mirrors the client call ([dux-conventions.md §5](./dux-conventions.md#5-server--client-symmetry)). It must be pure sugar: the accumulating generic that `createClient<typeof app>()` reads has to survive unchanged.

**Usage.**

```ts
import { createServer } from '@mszr/h3-dux'
import { FruitQuerySchema, NewFruitSchema } from '@orchard/domain'
import { requireKey } from './middleware/auth'

export const app = createServer()
  // No schema, no annotation: the response type is inferred from the handler return.
  .get('/health', { handler: () => ({ status: 'ripe' as const, at: new Date().toISOString() }) })
  // `validate.query` runs at request time; `event.context.query` is typed AND validated.
  .get('/fruits', {
    validate: { query: FruitQuerySchema },
    handler: e => orchard.list(e.context.query),
  })
  // `:id` is parsed from the path → `event.context.params.id` is typed `string`.
  .get('/fruits/:id', { handler: e => orchard.get(e.context.params.id) })
  // `middleware` passes straight through to h3 — this is how "auth" works. `status` sets the success code.
  .post('/fruits', {
    middleware: [requireKey],
    status: 201,
    validate: { body: NewFruitSchema },
    handler: e => orchard.create(e.context.body),
  })

export type App = typeof app // ← the single source of truth for the client
```

**Proposed approach.** Add `get`/`post`/`put`/`patch`/`delete`/`head`/`options` methods to the `H3Typed` subclass (`src/h3-typed.ts`). Each is a thin forward to the existing `.route()` with the verb filled in (`get(route, opts) → this.route({ route, get: opts })`), so the return type stays `H3Typed<MergePair<Routes, RouteRecord<…>>>` and accumulation is untouched. `opts` is the existing per-method def (`validate`, `middleware` → route-level, `meta`, `status`, `handler`) — the only new surface is the call shape.

**Status:** ☑ done.

---

## 2. Per-verb client sugar

**Why.** The client should read symmetrically with the server: `api.get(path, opts)` instead of `api(path, { method: 'get', … })`. The bare form stays — sugar never removes the primitive.

**Usage.**

```ts
import { createClient } from '@mszr/h3-dux'
import type { App } from '../server/app'

const api = createClient<App>({ baseURL })

const health = await api.get('/health')
//    → { status: 'ripe'; at: string }   inferred end-to-end, never hand-typed
const page = await api.get('/fruits', { query: { sort: 'price', limit: 2 } })
//    query keys autocomplete from FruitQuerySchema; unknown keys are rejected
```

**Proposed approach.** `createClient` returns the existing callable (`TypedFetch<App>`) with verb methods bound onto it: `api.get = (route, opts) => api(route, { ...opts, method: 'get' })`, typed by narrowing `TypedFetch`'s `method`-keyed options per verb. No change to `createTypedFetch`'s core generics — the verb methods are a typed facade over the same call.

**Status:** ☑ done.

---

## 3. Path-param interpolation on the client

**Why.** For a simple string param, `api.get(\`/fruits/${id}\`)` is the most natural call. It should typecheck against the `/fruits/:id` route, alongside the keyed `params` form (which stays required for coerced, typed, or multiple params).

**Usage.**

```ts
const apple = await api.get(`/fruits/${someId}`)            // apple typed as Fruit
const same = await api.get('/fruits/:id', { params: { id: someId } }) // equivalent
```

**Proposed approach.** Accept fetchdts **template-literal paths** as a `Route` input: map each `/x/:id` pattern to `/x/${string}` and let the call site match either the literal pattern or its interpolated form. This is internal to `typed-fetch.ts`'s route-key resolution (the runtime already interpolates `params` into the pattern); the work is purely type-level — widen `keyof R & string` to include the template-literal spellings and recover the matched endpoint from either.

**Status:** ☑ done.

---

## 4. Typed SSE

**Why.** A streaming endpoint should be as typed as a JSON one. Upstream already has a doc-only `stream` slot (`MethodStream` / `ResponseStreamMap` in `route-handler.ts`) that documents a streamed response but the client return is still hard-coded to `.json()`. The delta closes that: `sse(schema)` brands the response so the client returns an `AsyncGenerator<T>` and the server yields validated ticks.

**Usage.**

```ts
import { sse } from '@mszr/h3-dux'
import { RipenTickSchema } from '@orchard/domain'

// Server: brand the response as a stream of RipenTick.
app.get('/fruits/:id/ripen', {
  validate: { response: sse(RipenTickSchema) },
  handler: async function* (e) {
    for (const tick of orchard.ripen(e.context.params.id))
      yield tick // each yield validated against RipenTickSchema
  },
})

// Client: the brand makes this an async iterator, not a Result.
for await (const tick of api.get(`/fruits/${id}/ripen`))
  console.log(tick.ripeness) // tick: RipenTick
```

**Approach (delivered).** `sse(schema)` (`src/sse.ts`) attaches a runtime + type `EventStream<T>` brand to the schema. The contract (`DuxEndpoint.response`) preserves that brand, so the client's `VerbReturn` resolves the endpoint to `AsyncGenerator<T>` instead of `Promise<TypedResponse>`. On the server, `mount` detects the brand, drops the response from what upstream value-validates, and streams the handler's async generator via h3's `createEventStream` — validating each yield against the schema before pushing it. On the client, the verb methods return a **`DuxCall`** handle: `await` runs the JSON fetch, `for await` runs the SSE fetch (`accept: text/event-stream`, parsed by `parseEventStream`); only the consumed path fires. Stays inside fetchdts' `response` vocabulary so an official streaming type realigns cheaply.

**Status:** ☑ done.

---

## 5. Validation modes

**Why.** Validation should be predictable by default and controllable when you need it. The default is **eager and sequential** — a fixed pipeline `params → query → headers → body` that short-circuits on the first failure, so "validate the body only if the query passed" is free. When a handler needs to decide *whether* or *when* to validate (a dry-run that never touches the body, an order that depends on a prior result), `eager: false` switches to **manual** mode: nothing auto-runs, and you validate on demand.

This is the home of the validated-data model defined in [dux-conventions.md §4](./dux-conventions.md#4-the-validated-data-model): `event.context.<scope>` is the neutral typed read; `event.valid('<scope>')` is the deliberate, idempotent validator (throws → `422`).

**Usage.**

```ts
// DEFAULT (eager): params → query → body run in order, short-circuiting.
// `event.context.*` holds the validated values.
app.post('/checkout', {
  validate: { body: CheckoutOrderSchema, response: ReceiptSchema },
  handler: e => orchard.checkout(e.context.body), // body validated before the handler runs
})

// MANUAL (`eager: false`): nothing auto-validates; you choose when.
app.post('/import', {
  validate: { query: ImportQuerySchema, body: ImportBodySchema, eager: false },
  handler: async (e) => {
    const q = await e.valid('query') // runs query validation here; throws → 422
    if (q.mode === 'dry-run')
      return { ok: true } // never reads or validates the body
    const body = await e.valid('body') // validate the body only when needed
    return orchard.import(body)
  },
})
```

**Approach (delivered).** `mount` (`src/server.ts`) reads `validate.eager` (default `true`). In **eager** mode it hands the schemas to upstream's pipeline (params → query → headers → body, short-circuiting) and mirrors the validated query onto `event.context.query` and the validated body onto `event.context.body`. In **manual** mode (`eager: false`) only params (and response) reach upstream; `event.valid(scope)` validates query/body/headers on demand via the Standard Schema validator, caching onto `event.context[scope]` (so a re-read or a second `valid()` returns the cache). In eager mode `event.valid(scope)` just reads the already-validated value, so the accessor is mode-agnostic. The scopes `valid()` accepts are exactly those with a declared schema. **`event.validated` is not part of this surface** (conventions §4); upstream's accessor stays available underneath for diffing.

**Status:** ☑ done.

---

## 6. Response & param inference

Two delights that fell out of owning the server contract (part of delta 1). Both make a route read with *zero* ceremony, and both are pure type-level — the runtime is unchanged.

**Why.** Declaring a response schema just to type the client (`request<Receipt>` by hand, or a `validate.response` you don't otherwise need) is the boilerplate principle 2 forbids. And a `/fruits/:id` route already *says* it has a string `id` — making you restate that in a schema is repetition.

**Usage.**

```ts
// Response inferred from the handler return — the client sees `{ status: 'ripe'; at: string }`.
app.get('/health', { handler: () => ({ status: 'ripe' as const, at: new Date().toISOString() }) })

// `:id` typed as string from the pattern — no params schema needed.
app.get('/fruits/:id', { handler: e => orchard.get(e.context.params.id) })

// Opt into either when you want it: a schema validates AND types (and coerces).
app.get('/fruits/:id', {
  params: v.object({ id: v.pipe(v.string(), v.toNumber()) }), // e.context.params.id: number
  validate: { response: FruitSchema }, // runtime-validated + schema-typed
  handler: e => orchard.get(e.context.params.id),
})
```

**Approach (delivered).** In `DuxEndpoint` (`internal/route-types.ts`): `response` falls back to the captured handler-return type `Ret` when `InferMethodResponse<V>` is `unknown` (no `validate.response`); `params` resolves to the schema's output if a `params` schema is given, else to `RouteParams<Route>` — a type that reads `:param` names straight from the route literal. Declaring a schema always wins (it adds runtime validation and coercion). `Ret` is captured without `const`, so the inferred response is the plain shape you return (literals still come from an explicit `as const`).

**Status:** ☑ done.

---

## Open decisions

Settled as the deltas landed; kept here so they aren't re-litigated.

- **`event.context` vs `event.validated`** — *settled.* `event.context.<scope>` is the neutral read and `event.valid()` the deliberate one; `event.validated` is not part of the dux surface (upstream's accessor stays underneath for diffing).
- **Validation-error envelope** — *settled (default).* Request failures are `400` (eager, via upstream) or `422` (manual `valid()`); response failures `500`; all carry `issues`. A custom envelope is a userland `onValidationError` ([dux-conventions.md §7](./dux-conventions.md#7-validation-errors)). Worth revisiting only if the demo shows a recurring shape to promote.
- **Verb coverage** — *settled.* The callable verbs (`get/post/put/patch/delete/head/options`) get verb methods; `trace`/`connect` stay on the underlying `app.app.route()`, matching upstream's `CallableMethod`.
