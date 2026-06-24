# h3-dux — spec

The deltas that make h3-dux more than a rename, in two generations. Each is **contract-driven**: it headlines the desired behavior and why, shows the intended usage, then proposes an implementation. The contract is the commitment; the proposed approach can move if reality teaches a better one.

- **Generation 1 (shipped)** — the authoring surface: per-verb server/client, interpolation, typed SSE, validation modes. Reached *Hono-level* end-to-end safety.
- **Generation 2 (planned)** — honesty, errors, scale: the contract kernel and everything it unlocks. This is what takes h3-dux *past* Hono and Elysia.

Everything not listed here is inherited from `h3-route-tools` and re-exported unchanged — see [dux-vision.md §4.3](./dux-vision.md#43-inherited-vs-ours). Vocabulary, the validated-data model, the kernel, the honest client, and the naming map are defined once in [dux-conventions.md](./dux-conventions.md) and referenced, not repeated.

Snippets use valibot schemas from the Orchard reference (`@orchard/domain`, mirrored in [`archive/`](../archive)) so the examples are concrete.

## Implementation status

| # | Delta | Where (in `h3-dux/src/`) | Status |
| --- | --- | --- | --- |
| 1 | Per-verb server authoring (+ response & param inference) | `server.ts`, `internal/route-types.ts` | ☑ done |
| 2 | Per-verb client sugar | `client.ts` | ☑ done |
| 3 | Path-param interpolation | `client.ts` | ☑ done |
| 4 | Typed SSE | `sse.ts`, `server.ts`, `client.ts` | ☑ done |
| 5 | Validation modes (`event.context` + `event.valid`) | `server.ts`, `internal/route-types.ts` | ☑ done |
| 6 | Cleaner inference + diagnostics-as-contract | `client.ts`, `client.dx.test.ts` | ☑ done |
| 7 | The contract kernel | `internal/contract.ts`, `internal/route-types.ts` | ☑ done |
| 8 | The honest client (`{ data, error }`, `.orThrow()`, `.raw()`) | `client.ts`, `sse.ts`, `errors.ts` | ☑ done |
| 9 | Typed error contracts (`errors`, `event.error`, 422) | `route-types.ts`, `server.ts`, `errors.ts` | ☑ done |
| 10 | Response kinds + SSE hardening | `response.ts`, `internal/route-types.ts`, `internal/contract.ts`, `client.ts`, `errors.ts`, `server.ts`, `sse.ts` | ☑ done |
| 11 | Delta-aware composition (`createRouter`, `.mount`, `.native`) | `router.ts` (new), `server.ts` | ☐ planned |
| 12 | Typed event-context augmentation (`defineMiddleware`) | `middleware.ts` (new), `server.ts`, `router.ts` | ☐ planned |
| 13 | Nitro deltas via codegen | `nitro.ts`, `codegen.ts`, route-handler port | ☐ planned |
| 14 | Symmetry extras (standalone OpenAPI, interceptors) | `openapi.ts` (new), `client.ts` | ☐ planned |

## Roadmap

Generation 1 (phases 0–4) shipped. Generation 2 (phases 5–10) is ordered by dependency: diagnostics first (clean baseline before adding generic complexity), then the kernel and what it unlocks, then scale, then the Nitro moat.

| Phase | Deliverable | Status |
| --- | --- | --- |
| 0 | Workspace + scaffold: package re-exports upstream + `createServer`/`createClient`; docs | ☑ done |
| 1 | Client verb sugar (2) + path interpolation (3) | ☑ done |
| 2 | Server verb authoring (1) — `app.get`, accumulation preserved, response + param inference | ☑ done |
| 3 | Validation modes (5) — eager default + `eager: false` manual | ☑ done |
| 4 | Typed SSE (4) — `sse()` brand + client `AsyncGenerator` return | ☑ done |
| 5 | Cleaner inference + diagnostics-as-contract (6) — single signature, drop `O`/`NoExcess`, Selenita contract | ☑ done (source mode; `forModes`/perf pending W4) |
| 6 | The honest core — contract kernel (7), honest client (8), typed errors (9) | ☑ done |
| 7 | Response fidelity — response kinds + SSE hardening (10) | ☑ done |
| 8 | Scale — delta-aware composition (11) + typed event context (12) | ☐ |
| 9 | The Nitro moat — deltas via codegen (13) | ☐ |
| 10 | Symmetry extras — standalone OpenAPI + client interceptors (14) | ☐ |

Every delta ships with three test planes (runtime `*.test.ts`, type `*.test-d.ts`, editor-DX `*.dx.test.ts`), driven by the shared Orchard fixture in `src/test-support/`. For Generation 2, the editor-DX plane is promoted from "an error exists" to a *quality contract* ([dux-spec-workspace.md §5](./dux-spec-workspace.md#5-testing)).

## How it landed (the realities)

The contracts below are intact; a few implementation decisions are worth recording because they shaped the code:

- **`createServer` is a wrapper, not an `H3` subclass.** h3's `H3` already owns `app.get(path, handler)`, so a subclass would clash. `DuxServer` holds an inner `H3Typed` (exposed as `app`), delegates each verb to `.route(...)`, and exposes `fetch`/`request`/`use`. `createClient` reads its accumulated routes off a phantom `'~duxRoutes'` marker (falling back to upstream's `NormalizeRoutes`).
- **A small slice of upstream's per-method types is vendored** (`internal/route-types.ts`, `internal/serialize.ts`) because they aren't public exports — the same vendor-and-mark tier the workspace spec describes.
- **Two inferences came for free and are now first-class** (delta 1): response inference (a method with no `validate.response` contributes the handler's return to the contract) and param inference (`:params` typed from the pattern, no schema needed). Both are detailed in [Response & param inference](#response--param-inference-part-of-delta-1).
- **SSE uses a `DuxCall` handle** (delta 4): the verb methods return a value that is `await`-able (JSON path) and `for await`-able (SSE path); the type picks which, and only the consumed path fetches.

---

## Generation 1 — the authoring surface (shipped)

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

## Response & param inference (part of delta 1)

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

## Generation 2 — honesty, errors, scale (planned)

The next evolution. The ordering is deliberate: delta 6 cleans the diagnostic baseline (lowest risk, client-only); delta 7 introduces the kernel every later delta consumes; deltas 8–9 reshape the response contract for honesty and typed errors; 10 adds fidelity; 11–12 add scale; 13 makes the Nitro moat real; 14 rounds out symmetry. Each contract below is the commitment; the proposed approach is the current plan.

Design covenant for all of Generation 2 (principle 9): every delta is **opt-in power**. A route that declares no `errors`, a handler that returns plain JSON, a one-file app, a plain `(e, next)` middleware — each stays exactly as small as it is today. The new capability is always something you reach for, never a tax on the path that doesn't need it.

## 6. Cleaner inference + diagnostics-as-contract

**Why.** The worst current wart is a missing body field producing a wall of `SchemaWithPipe<…>` / `Omit<ObjectSchema<…>>` across *two* overloads — principle 3 inverted. It is fully fixable inside h3-dux's own client types ([client.ts](../h3-dux/src/client.ts)); no upstream change. Doing it first gives every later generic-heavy delta a clean baseline. Three independent causes:

1. **Static routes match both overloads.** `PathTemplate<P>` returns `P` unchanged when there is no `:param` ([client.ts:63](../h3-dux/src/client.ts:63)), so `/fruits` satisfies both the literal and interpolation overloads — TypeScript prints the whole error twice ("Overload 1 of 2 … Overload 2 of 2 …").
2. **`O & NoExcess<O, …>` anchors the expected type to a giant intersection** ([client.ts:98](../h3-dux/src/client.ts:98)), so the readable `body: { … }` shape is buried behind the generic soup.
3. **Schema internals leak** because `QueryHeaderOption<E>` is a deferred generic over the full `DuxEndpoint<ObjectSchema<…>>` ([client.ts:37](../h3-dux/src/client.ts:37)), printed unresolved.

**Usage (the contract is the *message*).** Dropping a required field from a `POST /fruits` body yields, at the body literal, a single diagnostic:

```text
Type '{ name: string; emoji: string; pricePerKg: number; }' is missing the following
properties from type '{ name: string; emoji: string; color: string; tags: string[];
pricePerKg: number; stockKg: number; }': color, tags, stockKg
```

**Approach (delivered).** Three causes, each fixed inside the client types ([client.ts](../h3-dux/src/client.ts)) — no upstream change:

- **Collapse the two overloads into one signature.** The doubling came from a literal and an interpolation overload, both attempted, both failing. A *single* call signature handles both addressing styles, with `WithParams = IsPattern<R, M, Route>` deciding whether `params` apply. With one signature TypeScript drops the `No overload matches this call` framing entirely and reports the direct error — a strictly better result than merely making two overloads disjoint.
- **Drop the `O` generic; delete `NoExcess`.** A verb *fixes* the method (`api.post` is the method; the return depends only on `R`, `M`, `Route`, never `O`). Typing the options parameter as the concrete `VerbOptions<E>` restores native fresh-object-literal excess checking (so `{ body, bogus }` flags `bogus` with code `2353`) and removes the intersection from the printed type. A deletion, not a patch.
- **Flatten the leak.** `VerbOptions` extracts each slot with an inline `infer` (`E extends { body: infer B } ? …`) and `Prettify`s the whole — so a diagnostic prints `{ name: string; … }`, never `QueryHeaderOption<DuxEndpoint<{ body: Omit<ObjectSchema<…>> }>>`. This is the client-side **kernel down-payment** (delta 7 generalizes it).

Two wins fell out of the single signature, both beyond the original plan:

- **A typo'd route names the valid routes.** `api.post('/health', …)` reports `not assignable to '"/fruits" | "/checkout" | "/import"'` instead of the whole accumulated route map. The route parameter is `Route extends VerbRoutes<R, M> ? Route : CleanPatterns<R, M>`: a valid literal *or* interpolated path is accepted as itself; anything else (a typo, or the empty string mid-type) falls back to the literal patterns — which is also exactly what the completion dropdown should show. `CleanPatterns` forces the union to evaluate via `extends infer U`, so it prints as literals, and keeping the interpolation forms *out* of the completion type stops a `${string}` template from subsuming `/fruits/:id` out of the dropdown.
- **A missing required `params` option reads `Expected 2 arguments, but got 1`**, not `Argument of type … is not assignable to never`.

**Locked as a Selenita contract.** The DX suite ([client.dx.test.ts](../h3-dux/src/client.dx.test.ts)) was promoted from "an error exists" to quality assertions: **exactly one** diagnostic (`toHaveErrorCount(1)`), the right TypeScript code (`2739`/`2322`/`2353`/`2554`), the offending field **named**, the message saying **missing**, the route error **naming the valid routes** — and a **leak guard** (`expectNoLeak`) that fails if any message contains `ObjectSchema`/`SchemaWithPipe`/`DuxEndpoint`/`No overload`/`Overload N`. Completion parity (`/fruits/:id` survives the dropdown) and a readable verb hover are asserted too. The full set of diagnostics was first captured empirically with a Selenita probe, then locked. No one else in this space tests diagnostic quality — making it a contract is itself differentiating ([dux-spec-workspace.md §5](./dux-spec-workspace.md#5-testing)).

**Server-side inspection.** The authoring plane was probed too and is already clean: `event.context` completes `body`/`params`/`query`, `event.context.body` completes its fields, `event.valid('…')` completes only the declared scopes, and a wrong handler return names the missing response fields with no schema leak. Two minor residuals are deferred (not blockers, no leak): an unknown key inside `validate` is silently accepted (the `V extends AnyMethodValidate` bound is loose), and the handler-return mismatch prints a `Ret & Response` intersection rather than the response shape alone. Both are candidates for a later polish pass.

**Status:** ☑ done (source mode). The remaining hardening — `forModes` parity (source vs built `.d.mts`) and the type-perf plane at 100/500/1000 routes — is tracked under workspace phase W4.

---

## 7. The contract kernel

**Why.** Every plane re-derives plain shapes from raw schema generics, which is the root of intricate inference, leaked diagnostics, and the flattened response that loses per-status structure. Normalize once. This is the spine of Generation 2 ([dux-conventions.md §8](./dux-conventions.md#8-the-contract-kernel)): deltas 8–14 are all producers or consumers of the kernel, which is *why* they compose instead of colliding.

**Usage.** Invisible — no user writes a kernel. It is the internal type `typeof app` accumulates and every surface reads:

```ts
interface EndpointContract {
  request: { params: unknown, query: unknown, headers: unknown, body: unknown } // resolved, prettified
  responses: Record<number, { body: unknown, kind: ResponseKind }> // per-status, never flattened
  success: number // the 2xx this endpoint answers with
}
```

**Approach (delivered).** `DuxEndpoint` ([route-types.ts](../h3-dux/src/internal/route-types.ts)) now stores the **resolved** contract: the request shapes, the success (2xx) body as `response` (`SuccessResponse<V, Ret>` — bare schema, the 2xx of a status map, or the inferred `Ret`), and a per-status **error map** as `errors` (`EndpointErrors` = a response status-map's non-2xx entries ∪ the declared `errors` ∪ an auto `422` when the endpoint validates any request scope). Upstream's status→schema map is **preserved**, not collapsed through `InferMethodResponse`. `internal/contract.ts` projects those resolved pieces into what the client consumes — `ClientData`, the discriminated `ClientError`, the `HonestResult` — and documents the `EndpointContract` kernel shape. The kernel is a *projection*: runtime validation still runs off the original schema.

Two realities worth recording:

- **Resolve before you compose, or the schema leaks.** A *conditional* type alias resolves in a hover, but a *union/object* alias prints its argument unresolved. Passing the raw `DuxEndpoint` to the result alias reintroduced the exact `ObjectSchema<…>` leak delta 6 fixed. The fix: pull the success body and error map out with `infer` first, and force the error map to evaluate with a homomorphic `{ [S in keyof Errors]: Errors[S] }`, so only resolved pieces reach the result. The verb hover now reads `DuxCall<HonestResult<SerializeObject<{…}>, ClientError<{ 422: ValidationErrorBody }>>, …>`.
- **The kernel is half-realized by design.** The success/error split, the resolved request shapes, and the client projection are in. The `kind` tag landed with delta 10 (a per-endpoint success kind, projected to `data` by the client); the unified per-status `responses: { [status]: { body, kind } }` representation and the codegen/OpenAPI consumers arrive with deltas 13/14 — each builds on this spine without reshaping it.

**Status:** ☑ done (phase 6).

---

## 8. The honest client

**Why.** `await (await api.get('/health')).json()` is a double-`await` inherited from `TypedResponse` ([client.ts:60](../h3-dux/src/client.ts:60)), and worse, `.json()` is typed as the success body *even on a 404* — a real type-safety hole. A value typed `Fruit` that can reject is the cursor lying (principle 3). Make the client honest by default ([dux-conventions.md §9](./dux-conventions.md#9-the-honest-client)).

**Usage.**

```ts
const api = createClient<App>({ baseURL })

// DEFAULT — the type shows failure is possible, so you acknowledge it
const { data, error } = await api.get('/fruits/:id', { params: { id } })
if (error) {
  if (error.kind === 'http' && error.status === 404)
    return notFound(error.data) // typed
  if (error.kind === 'transport')
    return offline() // never reached server
  return
}
data // Fruit — narrowed only after error is handled

const fruit = await api.get('/fruits/:id', { params: { id } }).orThrow() // Fruit, throws DuxError
const res = await api.get('/fruits/:id', { params: { id } }).raw() // TypedResponse<Fruit>
for await (const tick of api.get(`/fruits/${id}/ripen`)) // unchanged SSE
  console.log(tick.ripeness)
```

**Approach (delivered).** The existing `DuxCall` handle ([sse.ts](../h3-dux/src/sse.ts)) is generalized: default `await` resolves to `{ data, error }` (built by `buildResult` in `errors.ts`); `.orThrow()` returns `Promise<Data>`, rejecting with the `DuxError`; `.raw()` returns the upstream `TypedResponse` and never throws on a non-2xx; `for await` stays SSE. `DuxError` is `DuxHTTPError | DuxTransportError` — a fetch reject becomes the transport variant, a non-2xx the HTTP variant. The handle's type is `DuxCall<HonestResult<…>, Data>`; the `data`/`error` types are the delta-7 projections. The honest default *is* the typed result, so there is no separate `api.try` surface. `createTestClient(app)` wraps the in-process `fetch: app.request` pattern under a name that signals intent.

**Reality:** the body is read **once** and folded into the result; an empty/`204` response yields `data: undefined`, and a non-JSON body falls back to text. The success/error decision is `response.ok`, not the declared status — honest about what actually came back.

**Status:** ☑ done (phase 6).

---

## 9. Typed error contracts

**Why.** Upstream already models per-status response schemas and auto-registers `400/415/500` error schemas ([route-handler.ts:253](../../src/route-handler.ts:253)); h3-dux currently flattens that away. Preserving it gives the client a *discriminated, typed* `error` from the same Standard Schema declaration that feeds runtime validation and OpenAPI — the three(four)-for-one that meets or beats Elysia Treaty ([dux-conventions.md §10](./dux-conventions.md#10-typed-errors--results)).

**Usage.**

```ts
app.post('/fruits', {
  status: 201,
  validate: { body: NewFruitSchema, response: FruitSchema },
  errors: { 409: ConflictSchema }, // → runtime validation + client error type + OpenAPI
  handler: (e) => {
    if (orchard.has(e.context.body.name))
      throw e.error(409, { reason: 'already_exists' }) // checked against ConflictSchema, at the cursor
    return orchard.create(e.context.body)
  },
})
```

**Approach (delivered).** `errors?: Partial<Record<StatusCodeKey, SchemaWithJSON>>` is a `DuxVerbOpts` field, threaded as a type param `Err` and folded into the endpoint's error map (delta 7). `event.error(status, data)` is attached per request and typed against the declared `errors` schema for that status — `throw e.error(409, { … })` is checked at the cursor and throws an h3 `HTTPError`. Request-validation failures are **standardized on `422`** by wrapping the method's `onValidationError` with a 422 default before handing it to both upstream (eager) and the manual `validateScope`; the user's hook still wins, and response failures stay `500` because upstream's `validateResponse` re-wraps them. The `422` envelope (`{ source, issues }`) auto-registers into the error map when the endpoint validates a request scope. A failed SSE stream throws a `DuxHTTPError` rather than yielding an empty iterator.

**The one reality that makes it honest:** h3 serializes a thrown `HTTPError` as `{ status, message, data }`, so the declared payload lives under `.data`. The client **unwraps** that envelope (`errors.ts`), so `error.data` is exactly the `ErrorSchema`/`event.error` shape — `{ error, message }`, not the transport envelope. Without this, the typed-error contract would be a lie. (Runtime validation of `event.error` data is *not* run — the cursor check is the guarantee, and the schema feeds the client type + future OpenAPI.)

**Status:** ☑ done (phase 6).

---

## 10. Response kinds + SSE hardening

**Why.** Not every response is JSON; a `204`, a `text/plain` body, a download, or a stream each decode differently, and the client should not guess `.json()`. And the current SSE parser is fragile — it never checks `response.ok`, reads only one `data:` line via `.find`, and doesn't handle CRLF or multi-line events ([sse.ts:29](../h3-dux/src/sse.ts:29)).

**Usage.**

```ts
app.delete('/fruits/:id', { status: 204, handler: e => orchard.remove(e.context.params.id) }) // kind: empty
app.get('/health/text', { validate: { response: text() }, handler: () => 'ripe' }) //             kind: text → string
app.get('/fruits/:id/label', { validate: { response: binary() }, handler: e => makeLabel(e) }) //  kind: binary → Blob
// sse() is just the `sse` kind with a brand — streaming is no longer a special case
```

**Approach (delivered).** A `kind` (`json | text | empty | sse | binary`) is computed onto every `DuxEndpoint` (`SuccessKind<V, Ret>` in [route-types.ts](../h3-dux/src/internal/route-types.ts)) alongside the success body. It is inferred — `json` by default, a `void`/`null`/`undefined` return → `empty`, `sse()` → `sse` — or declared by the schema-free markers `text()`/`binary()` ([response.ts](../h3-dux/src/response.ts)), the siblings of `sse()`. The client projects the body **by kind** (`ClientData` in [contract.ts](../h3-dux/src/internal/contract.ts)): `string` for `text`, `Blob` for `binary`, `undefined` for `empty`, `AsyncGenerator<T>` for `sse`, the serialized wire shape for `json`. `parseEventStream` ([sse.ts](../h3-dux/src/sse.ts)) is hardened: it refuses a non-2xx (throws `DuxHTTPError`), handles `\n`/`\r\n`/`\r`, accumulates multi-line `data:` per the SSE spec (joined with `\n`, one leading space stripped), ignores comment/`id:`/`event:`/`retry:` lines, and flushes a final unterminated frame.

Two realities worth recording:

- **The wire must carry the kind, because h3 won't infer it.** h3 sends a bare `string` with *no* `content-type` and an untyped `Blob` with an empty one — so the client, which decodes by `content-type`, would re-`JSON.parse` `"42"` into `42`. The server now tags a `text()` response `text/plain` and a `binary()` response `application/octet-stream` (a typed `Blob`'s own mime wins, and a native `Response` self-describes), and the client reads `text/*` as a raw `string`, a `204`/empty body as `undefined`, and any other declared type as a `Blob`. Kind lives in the *type*; `content-type` is its runtime shadow, and the two are kept in lockstep.
- **Native `Response` stays honest by being opaque.** A handler may return a native `Response` (h3 passes it through), but its body is unknowable to the contract, so `data` is typed `unknown` — you reach for `.raw()` to inspect it, rather than the type asserting a shape the kit can't guarantee (principle 3).

**Status:** ☑ done (phase 7).

---

## 11. Delta-aware composition

**Why.** The deltas live only on the chaining `DuxServer` ([server.ts:187](../h3-dux/src/server.ts:187)); composing a domain into another file via upstream's `defineRoute`/`mountRoutes` drops you back to upstream ergonomics. Worse, `DuxServer` exposes no `.register()`, so even upstream's own `defineRoute` plugin **does not accumulate into `~duxRoutes`** — the type `createClient` reads — silently desyncing the client. This is the biggest strategic gap for "scale + highest DX" ([dux-conventions.md §12](./dux-conventions.md#12-composition--scope)).

**Usage.**

```ts
// fruits.routes.ts — a domain module, deltas intact, no server
export const fruits = createRouter()
  .get('/:id', { validate: { response: FruitSchema }, handler: e => orchard.get(e.context.params.id) })
  .post('/', { status: 201, validate: { body: NewFruitSchema }, handler: e => orchard.create(e.context.body) })

// app.ts
export const app = createServer()
  .mount('/fruits', fruits) // → /fruits/:id, /fruits; contracts merged into typeof app
  .mount(checkout)
```

**Proposed approach.** Add a route-free `createRouter()`/`defineRoutes()` builder that mirrors the `DuxServer` verb methods but accumulates a contract map instead of mounting (the dux twin of `defineRoute`, carrying every delta). Add `createServer().mount(prefix?, sub)` and `.register(plugin)`: both fold the sub-contract into `~duxRoutes` via the existing `MergePair` ([route-types.ts:235](../h3-dux/src/internal/route-types.ts:235)) and register the routes onto the inner `H3Typed`, prefixing paths when given. Detect duplicate route+method at the type level and surface a diagnostic instead of upstream's silent first-wins. Rename the `.app` escape hatch to `.native` and route additions through it back into `~duxRoutes` via `.register`. Document that type accumulation requires chaining, with router/`mount` as the sanctioned escape from giant chains.

**Status:** ☐ planned (phase 8).

---

## 12. Typed event-context augmentation

**Why.** `middleware: [...]` is plain h3 passthrough: if `requireKey` sets `event.context.user`, downstream handlers need a manual cast. There is no typed, standardized way for middleware to augment the event context. It is a *typing* primitive, decoupled from auth, which stays an app concern (vision §6). Parity with Hono `Variables` / Elysia `derive`·`decorate` ([dux-conventions.md §13](./dux-conventions.md#13-typed-event-context)).

**Usage.**

```ts
const withUser = defineMiddleware((e) => {
  const user = authenticate(e) // throws 401 on failure — plain h3
  return { user } //              typed context contribution
})

app.use(withUser).get('/me', { handler: e => e.context.user }) // e.context.user: User — no cast
```

**Proposed approach.** `defineMiddleware(fn)` wraps an h3 middleware whose return value (if any) is `Object.assign`ed onto `event.context` and whose *type* is captured as a context contribution `C`. Thread an accumulating context generic through `DuxServer`/`createRouter` (alongside `Routes`): `.use(defineMiddleware(...))` merges `C` into the server's context type, and each route's `MethodEvent` ([route-types.ts:143](../h3-dux/src/internal/route-types.ts:143)) intersects the contributions in scope onto `event.context`. Scope follows registration — global (`app.use`), per-router (`router.use`), or per-route (`middleware`) — so intellisense is route-specific, not a global bag. Plain `(e, next) => …` middleware still works and contributes nothing to the type.

**Status:** ☐ planned (phase 8).

---

## 13. Nitro deltas via codegen

**Why.** The Nitro demo hand-writes its `Routes` interface ([demo/nitro/client.ts:9](../h3-dux/demo/nitro/client.ts:9)) — exactly the boilerplate/drift principle 2 forbids — and file routes fall back to upstream `defineRouteHandler` with an *explicit* `params` schema, so the standalone deltas (response/param inference, validation modes, SSE, typed errors) don't reach them. Closing this turns Nitro's file routing — which neither Hono nor Elysia has — from underdelivered into a real moat.

**Usage.**

```ts
// generated — no hand-written interface, regenerated on nitro prepare/dev/build
import type { Routes } from '#h3-dux/routes'

export const api = createClient<Routes>({ baseURL })
// routes/fruits/[id].get.ts → :id inferred string from the filename, no params schema
```

**Proposed approach.** Ride the `types:extend` hook upstream already fires ([nitro.ts:235](../../src/nitro.ts:235)). `collectRouteHandlers` ([nitro.ts:79](../../src/nitro.ts:79)) already knows each route's path, import, and methods; emit a second virtual module (`#h3-dux/routes`) holding the generated kernel route map (`{ [route]: { [method]: EndpointContract } }`), and have `@mszr/h3-dux/nitro` re-export a `createClient` pre-bound to it. Codegen knows `[id]` → `:id`, so **param typing is recovered at generation time** — no `params` schema in the file. Port the *handler-time* deltas (validation modes, SSE, typed errors via `event.valid`/`event.error`) into the `defineRouteHandler` contract so file routes gain them; only path-derived inference needs codegen. The dux contract type rides the same generation upstream already does for `InternalApi` and OpenAPI.

**Status:** ☐ planned (phase 9). Higher risk — touches the codegen and a handler-surface port.

---

## 14. Symmetry extras

**Why.** Two roundings-out that the kernel makes cheap. The standalone `createServer` accumulates the whole contract in `typeof app`, so it can emit its own OpenAPI ("your routes are already the spec"), making the planes symmetric. And real apps need request-time hooks for auth-header injection and token refresh, which keeps "auth is just a header" honest.

**Usage.**

```ts
const doc = toOpenAPI(app) // OpenAPI 3.1 from typeof app, no Nitro required

const api = createClient<App>({
  baseURL,
  onRequest: ({ request }) => request.headers.set('authorization', token()),
  onResponse: ({ response }) => { /* refresh on 401, retry… */ },
})
```

**Proposed approach.** `toOpenAPI(app)` walks the kernel's `responses` (including `errors`) and `request` to produce the document the Nitro path already produces from codegen — one generator, two entry points. Add ofetch-style `onRequest`/`onResponse`/`onError` interceptors plus `signal`/timeout/retry/query-serialization as **transport** options on `createClient`, kept off the endpoint contract so they never pollute endpoint diagnostics (delta 6).

**Status:** ☐ planned (phase 10). Low–medium risk, mostly additive.

---

## Open decisions

Settled as the deltas landed; kept here so they aren't re-litigated.

- **`event.context` vs `event.validated`** — *settled.* `event.context.<scope>` is the neutral read and `event.valid()` the deliberate one; `event.validated` is not part of the dux surface — and in Generation 2 it leaves the *types*, not just the docs (delta 9). Upstream's accessor stays underneath for diffing.
- **Validation-error status** — *settled (revised for Gen 2).* Request-validation failures are **`422`, eager or manual** (delta 9) — Generation 1's `400`/`422`-by-mode split is gone, because a client must not see a different status for the same malformed request based on a server-internal mode choice. Response failures stay `500`; all carry `{ source, issues }`. A custom envelope is still a userland `onValidationError` ([dux-conventions.md §7](./dux-conventions.md#7-validation-errors)).
- **Verb coverage** — *settled.* The callable verbs (`get/post/put/patch/delete/head/options`) get verb methods; `trace`/`connect` stay on the underlying `app.native.route()`, matching upstream's `CallableMethod`.
- **Client default shape** — *settled.* The default is the honest `{ data, error }` result, not a bare value and not a Go tuple (delta 8). Honesty is the tiebreaker: a type that asserts `Fruit` but can reject is the cursor lying. `.orThrow()` is the legible opt-out; `.raw()` the web-standard escape hatch.
- **Typed errors: now, not later** — *settled.* The status→schema response map is preserved in the kernel from the start (delta 7), not deferred — because the response-contract shape decides whether errors, raw, Nitro, and OpenAPI stay coherent. The honest default *subsumes* a separate `api.try` surface (it already is the typed result), so we ship one mechanism, not three.
- **`params` placement** — *settled.* On the dux verb surface `params` is declared inside `validate` (one request block); it remains route-level underneath, where multi-method routes and grouped routers share one param schema ([dux-conventions.md §4](./dux-conventions.md#4-the-validated-data-model)).
