# h3-dux — spec

The five deltas that make h3-dux more than a rename. Each is **contract-driven**: it headlines the desired
behavior and why, shows the intended usage, then proposes an implementation. The contract is the commitment; the
proposed approach can move if reality teaches a better one.

Everything not listed here is inherited from `h3-route-tools` and re-exported unchanged — see
[dux-vision.md §4.3](./dux-vision.md#43-inherited-vs-ours). Vocabulary, the validated-data model, and the naming
map are defined once in [dux-conventions.md](./dux-conventions.md) and referenced, not repeated.

Snippets use valibot schemas from the Orchard reference (`@orchard/domain`, mirrored in
[`archive/`](../archive)) so the examples are concrete.

## Implementation status

| # | Delta | Touches | Status |
|---|---|---|---|
| 1 | Per-verb server authoring | the accumulating builder (`h3-typed.ts`) | ☐ planned |
| 2 | Per-verb client sugar | the typed fetch (`typed-fetch.ts`) | ☐ planned |
| 3 | Path-param interpolation | client call-option types (`typed-fetch.ts`) | ☐ planned |
| 4 | Typed SSE | the `stream` slot + client return derivation | ☐ planned |
| 5 | Validation modes | the request-validation pipeline (`route-handler.ts`) | ☐ planned |

## Roadmap

Sequenced so each step is independently testable. 2 and 3 are additive and cheap; 1, 4, 5 reach into the builder
and the validation pipeline.

| Phase | Deliverable | Status |
|---|---|---|
| 0 | Workspace + scaffold: package re-exports upstream + `createServer`/`createClient`; docs | ☑ done |
| 1 | Client verb sugar (2) + path interpolation (3) — additive, no builder changes | ☐ |
| 2 | Server verb authoring (1) — `app.get` over `.route`, accumulation preserved | ☐ |
| 3 | Validation modes (5) — eager-sequential default + `eager: false` manual | ☐ |
| 4 | Typed SSE (4) — `sse()` brand + client `AsyncGenerator` return | ☐ |

---

## 1. Per-verb server authoring

**Why.** Authoring a single-method route as `.route({ route: '/x', get: { handler } })` buries the HTTP verb
inside an object key. A verb method (`app.get('/x', { handler })`) reads like the route it defines and mirrors the
client call ([dux-conventions.md §5](./dux-conventions.md#5-server--client-symmetry)). It must be pure sugar: the
accumulating generic that `createClient<typeof app>()` reads has to survive unchanged.

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

**Proposed approach.** Add `get`/`post`/`put`/`patch`/`delete`/`head`/`options` methods to the `H3Typed` subclass
(`src/h3-typed.ts`). Each is a thin forward to the existing `.route()` with the verb filled in
(`get(route, opts) → this.route({ route, get: opts })`), so the return type stays
`H3Typed<MergePair<Routes, RouteRecord<…>>>` and accumulation is untouched. `opts` is the existing per-method def
(`validate`, `middleware` → route-level, `meta`, `status`, `handler`) — the only new surface is the call shape.

**Status:** ☐ planned.

---

## 2. Per-verb client sugar

**Why.** The client should read symmetrically with the server: `api.get(path, opts)` instead of
`api(path, { method: 'get', … })`. The bare form stays — sugar never removes the primitive.

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

**Proposed approach.** `createClient` returns the existing callable (`TypedFetch<App>`) with verb methods bound
onto it: `api.get = (route, opts) => api(route, { ...opts, method: 'get' })`, typed by narrowing
`TypedFetch`'s `method`-keyed options per verb. No change to `createTypedFetch`'s core generics — the verb methods
are a typed facade over the same call.

**Status:** ☐ planned.

---

## 3. Path-param interpolation on the client

**Why.** For a simple string param, `api.get(\`/fruits/${id}\`)` is the most natural call. It should typecheck
against the `/fruits/:id` route, alongside the keyed `params` form (which stays required for coerced, typed, or
multiple params).

**Usage.**

```ts
const apple = await api.get(`/fruits/${someId}`)            // apple typed as Fruit
const same = await api.get('/fruits/:id', { params: { id: someId } }) // equivalent
```

**Proposed approach.** Accept fetchdts **template-literal paths** as a `Route` input: map each `/x/:id` pattern to
`/x/${string}` and let the call site match either the literal pattern or its interpolated form. This is internal
to `typed-fetch.ts`'s route-key resolution (the runtime already interpolates `params` into the pattern); the work
is purely type-level — widen `keyof R & string` to include the template-literal spellings and recover the matched
endpoint from either.

**Status:** ☐ planned.

---

## 4. Typed SSE

**Why.** A streaming endpoint should be as typed as a JSON one. Upstream already has a doc-only `stream` slot
(`MethodStream` / `ResponseStreamMap` in `route-handler.ts`) that documents a streamed response but the client
return is still hard-coded to `.json()`. The delta closes that: `sse(schema)` brands the response so the client
returns an `AsyncGenerator<T>` and the server yields validated ticks.

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

**Proposed approach.** `sse(schema)` (shipped today as a typed pass-through that attaches an `EventStream<T>`
brand — see `src/index.ts`) routes through the existing `stream.response` slot so the server skips value-validating
the stream object while still validating each yielded chunk. On the client, detect the `EventStream` brand in the
response-type derivation (`ResponseOf<E>` in `typed-fetch.ts`) and return `AsyncGenerator<T>` parsed from
`text/event-stream` instead of `TypedResponse<T>`. Reuse the SSE-parsing loop already written in the Orchard
client (`archive/packages/domain/src/client.ts`). Stay inside fetchdts' `response` vocabulary so an official
streaming type realigns cheaply.

**Status:** ☐ planned.

---

## 5. Validation modes

**Why.** Validation should be predictable by default and controllable when you need it. The default is **eager and
sequential** — a fixed pipeline `params → query → headers → body` that short-circuits on the first failure, so
"validate the body only if the query passed" is free. When a handler needs to decide *whether* or *when* to
validate (a dry-run that never touches the body, an order that depends on a prior result), `eager: false` switches
to **manual** mode: nothing auto-runs, and you validate on demand.

This is the home of the validated-data model defined in
[dux-conventions.md §4](./dux-conventions.md#4-the-validated-data-model): `event.context.<scope>` is the neutral
typed read; `event.valid('<scope>')` is the deliberate, idempotent validator (throws → `422`).

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

**Proposed approach.** The eager pipeline already exists in `runRequestValidation` (`route-handler.ts`), which
validates params, then query, then headers, then body in order — formalize that as the documented contract and
keep the short-circuit. Add an `eager?: boolean` flag to the `MethodValidate` block (default `true`). When
`false`, skip the auto-run and expose `event.valid(scope)` — a per-scope validator that runs the matching
`validate*` function on first call, caches the result on `event.context`, and returns it (subsequent calls and any
`event.context.<scope>` read return the cache). In eager mode, `event.valid(scope)` returns the already-cached
value, so the accessor is mode-agnostic. **`event.validated` is not part of this surface** (conventions §4).

**Status:** ☐ planned.

---

## Open decisions

Small calls to settle as the deltas land; recorded here so they aren't re-litigated each time.

- **`event.context` mirroring.** We standardize on `event.context.<scope>` (h3 core direction) for the neutral
  read and `event.valid()` for the deliberate one. Whether to also keep upstream's `event.validated` as an
  internal alias is an implementation detail of delta 5, not a public contract.
- **Validation-error envelope.** Default stays upstream's `400` / `500` + `issues`; a `422` envelope is a userland
  `onValidationError` ([dux-conventions.md §7](./dux-conventions.md#7-validation-errors)). If the Orchard
  reference shows a recurring envelope worth promoting to a documented default, revisit here.
- **Verb coverage.** Deltas 1–2 cover the callable verbs (`get/post/put/patch/delete/head/options`); `trace` and
  `connect` stay `.route()`-only, matching upstream's `CallableMethod`.
