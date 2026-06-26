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
| 11 | Delta-aware composition (`createRouter`, `.mount`, `.native`) | `router.ts` (new), `server.ts` | ☑ done |
| 12 | Typed middleware bindings (`defineMiddleware`, `event.bindings`, `requires`) | `middleware.ts` (new), `server.ts`, `router.ts`, `internal/route-types.ts` | ☑ done |
| 13 | Nitro deltas via codegen | `file-route.ts` (new), `internal/nitro-codegen.ts` (new), `internal/runtime.ts` (new), `nitro.ts` | ☑ done |
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
| 8 | Scale — delta-aware composition (11) + typed middleware bindings and event accessors (12) | ☑ done |
| 9 | The Nitro moat — deltas via codegen (13) | ☑ done |
| 10 | Symmetry extras — standalone OpenAPI + client interceptors (14) | ☐ |

Every delta ships with three test planes (runtime `*.test.ts`, type `*.test-d.ts`, editor-DX `*.dx.test.ts`), driven by the shared Orchard fixture in `src/test-support/`. For Generation 2, the editor-DX plane is promoted from "an error exists" to a *quality contract* ([dux-spec-workspace.md §5](./dux-spec-workspace.md#5-testing)).

## How it landed (the realities)

The contracts below are intact; a few implementation decisions are worth recording because they shaped the code:

- **`createServer` is a wrapper, not an `H3` subclass.** h3's `H3` already owns `app.get(path, handler)`, so a subclass would clash. `DuxServer` holds an inner `H3Typed` (exposed as `.native` since delta 11, was `.app`), delegates each verb to `.route(...)`, and exposes `fetch`/`request`/`use`/`mount`/`register`. `createClient` reads its accumulated routes off a phantom `'~duxRoutes'` marker (falling back to upstream's `NormalizeRoutes`).
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

**Bare-handler shorthand (added later).** When a route needs no options, the handler may be passed directly — `app.get('/health', e => …)` — as sugar for `{ handler }`, response still inferred from the return ([dux-conventions.md §5](./dux-conventions.md#5-server--client-symmetry)). It is implemented as a **single signature with a `VerbArg = ServerOpts | MethodHandler` union parameter** (the bare arm fixes validate/params/status/errors to defaults and infers only `Ret`), *not* a second overload — measured empirically against delta 6's bar: a second overload reintroduces the "No overload matches this call" wall for a bad options object, while the union parameter keeps a single `2353` at the offending property (and prints the `VerbArg` alias, no schema leak). Routers carry the same `RouterArg` union; the client stays options-only.

**Status:** ☑ done (verb forms + bare-handler shorthand).

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

This is the home of the validated-data model defined in [dux-conventions.md §4](./dux-conventions.md#4-the-validated-data-model): eager validated values are read through `event.params/query/body` (root aliases of `event.context.*`); `event.valid('<scope>')` is the deliberate, idempotent validator for declared schemas (throws → `422`).

**Usage.**

```ts
// DEFAULT (eager): params → query → body run in order, short-circuiting.
// `event.body` and `event.context.body` are the same validated value.
app.post('/checkout', {
  validate: { body: CheckoutOrderSchema, response: ReceiptSchema },
  handler: e => orchard.checkout(e.body), // body validated before the handler runs
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

**Approach (delivered; event-surface refinement landed in phase 8).** `mount` (`src/server.ts`) reads `validate.eager` (default `true`). In **eager** mode it hands the schemas to upstream's pipeline (params → query → headers → body, short-circuiting) and stores validated values on `event.context`. In **manual** mode (`eager: false`), `event.valid(scope)` validates query/body/headers on demand via the Standard Schema validator and caches the result in the same store. In eager mode `event.valid(scope)` reads the cached value. Phase 8 added the root aliases (`event.params/query/body`) over that store and tightened direct property types: a deferred manual scope never advertises its schema output before `valid()` (its direct `event.body` is `unknown`), and a declared eager body exposes its validated output. **`event.validated` is dropped from the dux event type** (conventions §4); upstream's accessor stays available underneath for diffing.

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
  validate: {
    params: v.object({ id: v.pipe(v.string(), v.toNumber()) }), // e.context.params.id: number
    response: FruitSchema, // runtime-validated + schema-typed
  },
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
- **The kernel is canonical as of phase 9.** Phase 6 landed the success/error split, resolved request shapes, and client projection; the `kind` tag landed with delta 10. Phase 9 completed the canonical `{ request, responses, success }` representation: `DuxEndpoint` *is* the kernel now (`internal/route-types.ts`), the client reads it through `SuccessEntry`/`ClientData`/`ClientErrors` (`internal/contract.ts`), and **both** `createServer`'s `typeof app` and Nitro's generated `#h3-dux/routes` produce the same shape — so one `createClient` is typed from either. No second endpoint shape was invented. Phase 10 adds the standalone OpenAPI consumer of the same kernel.

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
const res = await api.get('/fruits/:id', { params: { id } }).raw() // native Response + parse(): Promise<Fruit>
const sameFruit = await res.parse()
for await (const tick of api.get(`/fruits/${id}/ripen`)) // unchanged SSE
  console.log(tick.ripeness)
```

**Approach (delivered).** The existing `DuxCall` handle ([sse.ts](../h3-dux/src/sse.ts)) is generalized: default `await` resolves to `{ data, error }` (built by `buildResult` in `errors.ts`); `.orThrow()` returns `Promise<Data>`, rejecting with the `DuxError`; `.raw()` returns the native kind-aware `DuxRawResponse<Data, Kind>` and never throws on a non-2xx; `for await` stays SSE. Raw responses add one universal reader, `.parse()`, while retaining the standard `.json()`/`.text()`/`.blob()` surface; only JSON endpoints narrow `.json()` to `Data`. `DuxError` is `DuxHTTPError | DuxTransportError` — a fetch reject becomes the transport variant, a non-2xx the HTTP variant. The honest default *is* the typed result, so there is no separate `api.try` surface. `createTestClient(app)` wraps the in-process `fetch: app.request` pattern under a name that signals intent.

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
app.get('/health/text', { handler: () => 'ripe' }) //                                              inferred text → string
app.get('/fruits/:id/label', { handler: e => makeLabel(e) }) //                                    inferred binary → Blob
app.get('/native', { handler: () => typedResponse({ ok: true }, { status: 201 }) }) //              typed native Response
// sse() is just the `sse` kind with a brand — streaming is no longer a special case
```

**Approach (delivered).** A `kind` (`json | text | empty | sse | binary`) is computed onto every `DuxEndpoint` alongside the success body. The common path is fully inferred from the response schema/handler return: objects → `json`, strings → `text`, Blob/bytes/streams → `binary`, and empty values, `204`/`205`, or `HEAD` → `empty`. Body-returning empty-status handlers fail at the cursor. `text()`/`binary()` remain schema-free explicit overrides; `sse()` carries its element schema. The client projects the body **by kind** (`ClientData` in [contract.ts](../h3-dux/src/internal/contract.ts)): `string`, `Blob`, `undefined`, `AsyncGenerator<T>`, or the serialized JSON shape. `parseEventStream` ([sse.ts](../h3-dux/src/sse.ts)) refuses non-2xx responses, handles homogeneous and mixed `\n`/`\r\n`/`\r` boundaries, accumulates multi-line `data:`, ignores non-data fields, flushes the decoder, and emits a final unterminated frame.

Two realities worth recording:

- **Kind is not MIME.** h3 does not add enough metadata to distinguish a numeric-looking string from JSON or a `text/csv` Blob from text. The server therefore infers the actual handler value and adds a standards-valid `dux-kind` parameter to `Content-Type`. The MIME remains intact; the parameter tells the dux client how to expose the bytes. This works through CORS because `Content-Type` is a safelisted response header.
- **Native `Response` can be opaque or typed.** A plain platform `Response` still passes through honestly as body-`unknown`. `typedResponse(data, init)` constructs that same native object but carries an inferred phantom body contract and wire kind, so default await, `.orThrow()`, and `.raw().parse()` all retain high-quality inference.

**Status:** ☑ done (phase 7).

---

## 11. Delta-aware composition

**Why.** The deltas live only on the chaining `DuxServer` ([server.ts:187](../h3-dux/src/server.ts:187)); composing a domain into another file via upstream's `defineRoute`/`mountRoutes` drops you back to upstream ergonomics. Worse, `DuxServer` exposes no `.register()`, so even upstream's own `defineRoute` plugin **does not accumulate into `~duxRoutes`** — the type `createClient` reads — silently desyncing the client. This is the biggest strategic gap for "scale + highest DX" ([dux-conventions.md §12](./dux-conventions.md#12-composition--scope)).

**Usage.**

```ts
// fruits.routes.ts — a domain module, deltas intact, no server
export const fruits = createRouter('/fruits')
  .get('/:id', { validate: { response: FruitSchema }, handler: e => orchard.get(e.params.id) })
  .post('/', { status: 201, validate: { body: NewFruitSchema }, handler: e => orchard.create(e.body) })

// app.ts
export const app = createServer()
  .mount(fruits) // → /fruits/:id, /fruits; contracts merged into typeof app
  .mount(checkout)
```

Router-owned dynamic prefixes are inferred in every child handler:

```ts
export const friends = createRouter('/users/:userId/friends')
  .get('/:friendId', {
    handler: event => loadFriend(event.params.userId, event.params.friendId),
  })

createServer().mount(friends)
```

When an enclosing composition layer must own a dynamic segment, the child declares only that exceptional dependency:

```ts
export const friends = createRouter('/friends', { parentParams: ['userId'] })
  .get('/:friendId', {
    handler: event => loadFriend(event.params.userId, event.params.friendId),
  })

createServer().mount('/users/:userId', friends)
```

**Approach (delivered).** `createRouter(prefix?, options?)` ([router.ts](../h3-dux/src/router.ts)) is the single delta-aware composition builder; a second synonym would add vocabulary without adding capability. It *records* endpoints (method, prefix-joined path, options) without mounting them. The literal prefix is carried in the router type and joined onto each local path with `JoinPath<Prefix, Local>`, so child handlers see the prefix's `:params` (param inference reads the full pattern) and the client sees one flat map. `createServer().mount(router)` / `.mount(outerPrefix, router)` ([server.ts](../h3-dux/src/server.ts)) replay the recorded entries onto the inner `H3Typed` via the same `mount()` the verbs use, preserve the router middleware chain captured when each endpoint was authored, and fold the contract into `~duxRoutes` with `MergePair`; a static outer prefix is `PrefixRoutes`. `.register(plugin)` accumulates an upstream `defineRoute` plugin via `InferRoutes`. Dynamic outer params can't be inferred retroactively, so `options.parentParams` is the escape hatch — threaded as an `ExtraParams` generic folded into the handler's `event.params` and the endpoint's client params, while `.mount()` verifies that the outer path supplies exactly those names and does not duplicate child params. Duplicate route+method is diagnosed while authoring one builder and when composing through either `.mount()` or `.register()`. Router replay state is private module data rather than mutable public arrays, and `DuxRouter` is exported as a type rather than a second construction API. `.app` is renamed `.native`. Type accumulation requires chaining; the router/`mount` split is the sanctioned escape from giant chains.

**Realities worth recording.** Two diagnostics (binding collision, `.mount` requirement) ride genuinely multi-form methods (`.use`, `.mount`), so a failure surfaces as TypeScript's "No overload matches" framing rather than a single line — honest, and free of schema generics, but not the single-diagnostic cleanliness the *route* argument achieves. The duplicate-route guard was deliberately moved onto the route argument (not intersected into the options alias) precisely so its message stays a clean sentence.

**Status:** ☑ done (phase 8).

---

## 12. Typed middleware bindings

**Why.** Plain h3 middleware can add arbitrary request state, but downstream handlers cannot know its shape without a global declaration or cast. Global `H3EventContext` augmentation lies for routes where the middleware did not run; interpreting a middleware return as state would conflict with h3, where returns are responses. The dux primitive must preserve all middleware behavior while carrying precise, scoped capabilities through composition ([dux-conventions.md §13](./dux-conventions.md#13-typed-middleware-bindings)).

**Usage — reusable middleware.**

```ts
const withSession = defineMiddleware({
  bindings: event => ({
    session: readSession(event),
  }),
})

const withUser = defineMiddleware({
  requires: [withSession],
  staged: event => ({
    token: decodeToken(event.bindings.session),
  }),
  bindings: event => ({
    user: loadUser(event.staged.token),
  }),
  async handler(event, next) {
    if (event.bindings.user.suspended)
      return redirect('/account-suspended')
    return next()
  },
})

export const app = createServer()
  .use(withSession)
  .use(withUser)
  .get('/me', { handler: event => event.bindings.user })
```

**Usage — inline, route-local, and externally required.**

```ts
const app = createServer()
  .use({
    staged: event => ({ startedAt: performance.now() }),
    bindings: event => ({ requestId: crypto.randomUUID() }),
    async handler(event, next) {
      const response = await next()
      console.log(event.bindings.requestId, performance.now() - event.staged.startedAt)
      return response
    },
  })

const account = createRouter('/account')
  .requires(withUser) // type requirement only; does not run withUser
  .get('/me', { handler: event => event.bindings.user })
  .post('/avatar', {
    middleware: [withUpload], // registers and runs withUpload for this endpoint
    handler: event => saveAvatar(event.bindings.upload),
  })

app.mount(account) // checked: the parent already provides withUser
```

**Proposed approach.**

- Introduce a branded `TypedMiddleware<Requires, Bindings>` that is also a real h3 `Middleware`. `defineMiddleware(fn)` preserves the direct callback form for ordinary middleware; `defineMiddleware({ requires?, staged?, bindings?, handler? })` adds typed capability metadata.
- `staged(event)` runs first and its inferred return is visible as `event.staged` only inside that middleware's `bindings` and `handler`. It is stored temporarily at `event.context.staged`; the wrapper hides/restores the enclosing staged scope while `next()` runs, so staged values never enter downstream types or runtime state.
- `bindings(event)` runs next. Its inferred object is merged into canonical `event.context.bindings` and exposed through `event.bindings`. There is no imperative setter form: the returned object is simultaneously the implementation and the outgoing type contract.
- `handler(event, next)` begins after bindings are installed. `next` is controlled by the handler: omitting it intercepts, returning it continues directly, and `await next()` surrounds downstream middleware/the route with before/after logic. With no handler, the wrapper continues automatically.
- Existing bindings are mutable with assignable values on that request. Changes made before `next()` are visible downstream; changes made downstream are visible to outer handlers after `await next()`. Mutations neither survive the request nor change accumulated route types, and no imperative API can publish a new typed key.
- `app.use(options)` and `router.use(options)` accept the same options object as `defineMiddleware`; the inline form receives the chain's accumulated bindings contextually. Both also retain the direct `(event, next) => …` form. One middleware API, whether reusable or inline.
- `requires: [providers]` supplies typed input and checks that their binding capabilities are already present without executing providers. For a reusable middleware it declares the bindings needed by `staged`/`bindings`/`handler`; for inline middleware it can document a subset of the already inferred chain. `.requires(provider)` on a router and `requires: [provider]` on an endpoint record external requirements that must be satisfied by the enclosing scope.
- `.use(provider)` and endpoint `middleware: [provider]` **register and execute** middleware. `.requires(provider)` and route `requires: [provider]` **only consume its type capability**. This is the explicit distinction between resupplying middleware locally and relying on one registration at a parent mount.
- Thread an accumulated bindings generic alongside `Routes` through `DuxServer`, routers, and `MethodEvent`. Provider requirements must be satisfied in registration order; middleware is sequential/onion-shaped, so later middleware sees earlier bindings. Two providers in the same chain/tuple may not publish the same key; `requires` publishes nothing and cannot collide. Existing-key assignment remains request-local mutation, not provider override.
- h3 `app.use()` remains runtime-global. Chained inference is available after the `.use()` call because TypeScript accumulation is lexical; domain-exact runtime scope comes from router-owned or endpoint middleware.
- Add root event getters `params`, `query`, `body`, and `bindings`, backed by `event.context`; add the middleware-private `staged` getter during its lifecycle. Direct request access follows the honest eager/manual rules in conventions §4. No single-letter aliases are added.
- Plain h3 middleware remains accepted and contributes no bindings type. Global `declare module 'h3'` augmentation remains an escape hatch for genuinely universal external state, not the scoped dux architecture.

**Approach (delivered).** `defineMiddleware` ([middleware.ts](../h3-dux/src/middleware.ts)) brands a real h3 `Middleware` with a phantom `{ requires, bindings }` metadata pair. The options form returns a wrapper that runs `staged → bindings → handler(event, next)`: `staged` is stored at `event.context.staged` and hidden/restored across `next()`—including exceptional exits from `bindings` or downstream—so another middleware never observes the wrong private scope; bindings merge into `event.context.bindings`, the shared store the root `event.bindings` getter reads. `ensureDuxAccessors` installs the `params/query/body/bindings/staged` getters once per event (idempotent across middleware and the route handler).

`.use(provider)` threads a `Bindings` generic through `DuxServer`/`DuxRouter`; registration checks both halves of the capability contract: every `requires` binding must already be available with an assignable type, and no published key may collide. Inline `{ staged, bindings, handler }` uses the same checks, while a bare `(event, next) => …` callback — the inline equivalent of `defineMiddleware(fn)`, no wrap — routes through an `InlineCallback<Bindings>` overload (placed first, brand excluded) that types its `event` against the chain's accumulated bindings; the `defineMiddleware` wrap is only for middleware defined outside `.use`. (Later refinement: the original `PlainMiddleware` overload left a bare callback's params implicit-`any`, so the wrap was needed; `InlineCallback` fixes both the typing and the ceremony — `toMiddleware` installs the dux accessors for a bare callback so its `event.bindings` is safe at runtime.) Endpoint `middleware: […]` validates typed providers sequentially, so a later provider may require an earlier one but duplicate keys fail at the cursor. Endpoint `requires: […]` and `router.requires(provider)` run nothing and are accepted only when the enclosing chain/mount supplies the capability. `event.validated` is dropped from the dux event type; the honest direct-property typing (manual-mode `event.body` is `unknown`, declared eager body is its validated output) lands here too.

**Status:** ☑ done (phase 8).

---

## 13. Nitro deltas via codegen

**Why.** The Nitro demo hand-writes its `Routes` interface ([demo/nitro/client.ts:9](../h3-dux/demo/nitro/client.ts:9)) — exactly the boilerplate/drift principle 2 forbids — and file routes fall back to upstream `defineRouteHandler`, so the standalone deltas (validation modes, response inference and kinds, SSE, typed errors, event accessors, middleware bindings) do not reach them. Closing this turns Nitro's filesystem routing — which neither Hono nor Elysia has — from underdelivered into a real moat.

The filesystem already states the path and, when suffixed, the method. The delightful surface never repeats either.

### Usage — method-locked files

```ts
// routes/checkout.post.ts → POST /checkout
export default defineFileRoute({
  status: 201,
  validate: {
    body: CheckoutSchema,
    response: ReceiptSchema,
  },
  errors: {
    409: OutOfStockSchema,
  },
  handler: event => checkout(event.body),
})
```

`defineFileRoute` has no `.get()`/`.post()` methods. A method suffix is filename-owned; repeating it in source would permit contradictions such as `defineFileRoute.get()` inside `checkout.put.ts`.

`defineFileRoute` is the zero-provider convenience factory: it uses the same definition engine as `createFileRouteFactory()` with no middleware capabilities added.

### Usage — unsuffixed files

An unsuffixed file follows Nitro's all-method behavior. One method-neutral handler may be shared:

```ts
// routes/health.ts → every method at /health
export default defineFileRoute({
  validate: { response: HealthSchema },
  handler: () => health(),
})
```

Or the file may dispatch distinct method contracts:

```ts
// routes/checkout/[id].ts → multiple methods at /checkout/:id
export default defineFileRoute({
  params: CheckoutParamsSchema,
  get: {
    handler: event => checkoutStatus(event.params.id),
  },
  post: {
    status: 201,
    validate: { body: CheckoutSchema, response: ReceiptSchema },
    handler: event => checkout(event.params.id, event.body),
  },
  delete: {
    status: 204,
    handler: event => clearCheckout(event.params.id),
  },
})
```

The shared flat form forbids `validate.body`: request bodies are method-specific. Use the method map when any method accepts a body or has a distinct status, error, validation, response kind, or handler. `HEAD` is always projected as an empty client response even when it shares the runtime handler. A method-locked file using the method-map form fails generation with a filename-focused diagnostic instead of silently declaring unreachable methods.

Params are route-wide in a method map, so `params` lives in the outer definition; query/body/headers/response validation remains inside each method. This preserves one params schema per filename path without duplicating it per method.

### Usage — file-route capabilities

```ts
// utils/app-route.ts — no filename is reserved
export const defineAppRoute = createFileRouteFactory()
  .use(withRequestId)
  .use(withDatabase)
```

```ts
// routes/orders.get.ts
export default defineAppRoute({
  middleware: [withUser],
  handler: event =>
    listOrders(event.bindings.database, event.bindings.user),
})
```

An independently authored feature may state what its eventual parent must provide:

```ts
// store.factory.ts — not callable while `withDatabase` is unresolved
export const storeFeature = createFileRouteFactory()
  .requires(withDatabase)
  .use(withStore)

// utils/app-route.ts — the checked composition boundary
export const defineStoreRoute = defineAppRoute.compose(storeFeature)
```

`compose()` checks the same capability laws as router `.mount()`: requirements are present and assignable, providers do not collide, and the resulting middleware order is deterministic. Required middleware already supplied by the parent is not registered or executed twice.

### Usage — generated client

```ts
// generated on nitro prepare/dev/build — no hand-written route interface
import { createClient } from '@mszr/h3-dux'
import type { Routes } from '#h3-dux/routes'

export const api = createClient<Routes>({ baseURL })

const { data, error } = await api.get(`/fruits/${id}`)
```

### Contract

Phase 9 delivers five connected pieces:

1. **A dux-native file handler.** `defineFileRoute(def)` carries validation modes, response inference and kinds, SSE, typed errors, root event accessors, and route-local typed middleware into Nitro file routes. `createFileRouteFactory()` produces the same callable definition surface with accumulated middleware bindings.
2. **Checked factory composition.** `.use()` executes providers; `.requires()` records capabilities and makes the factory non-callable until a parent satisfies them through `.compose()`. This is the lexical relationship TypeScript needs across files and the file-route counterpart of router `.mount()`.
3. **One canonical endpoint kernel.** Before codegen consumes it, complete the phase-6 projection so standalone and file routes both expose `{ request, responses, success }`. Runtime schemas remain separately attached for validation and OpenAPI; the public route map contains only resolved shapes.
4. **A generated route map.** `#h3-dux/routes` contains `{ [normalizedPath]: { [method]: EndpointContract } }`, using Nitro's own route table as path/method truth. It feeds the existing `createClient<Routes>()`; no second client implementation or pre-bound virtual client ships in phase 9.
5. **Codegen diagnostics.** Generation rejects runtime-inspectable contradictions, and the generated declaration carries type assertions for shape-only checks. Together with project typecheck they reject unreachable methods, duplicate path+method contracts, unresolved factory requirements, capability collisions, body-bearing shared all-method handlers, and declared params whose keys disagree with the normalized filename path.

### Filename inference: the honest boundary

Codegen knows that `routes/users/[userId]/friends/[friendId].get.ts` is `GET /users/:userId/friends/:friendId`; an ordinary TypeScript function does not know the filename containing its call while the callback is contextually typed. Therefore:

- the generated client receives exact filename-derived params with no repeated route declaration;
- a handler receives exact/coerced params when it declares `validate.params`;
- without `validate.params`, a file-route handler receives `Record<string, string>`;
- generated type assertions compare an explicitly declared params shape with the filename path during project typecheck;
- a source transform or language-service plugin for schema-free exact handler params is a possible later enhancement, not a phase-9 promise.

This is deliberately asymmetric: codegen uses knowledge it genuinely has, while the source type never claims knowledge it does not.

For the generated client, codegen replaces the broad raw handler params with the exact filename-derived string shape when no schema exists. A declared params schema wins with its logical/coerced client type after the generated key-agreement check.

### Capability scope and performance

Factory middleware is replayed inside the matched route's h3 pipeline. If one hundred routes use a factory, a request to one route executes each provider once; the other ninety-nine execute nothing. The repeated registration metadata is negligible and preserves full onion semantics, including work after `await next()`.

Registering the same provider globally and through a factory may execute it twice. h3-dux diagnoses duplicate providers where both registrations are visible in its typed composition, but never silently deduplicates middleware: ordering and side effects are observable behavior. Plain Nitro global middleware contributes no scoped binding type; use factory `.use()`, route-local `middleware`, or explicit global h3 augmentation for genuinely universal external state.

### Proposed implementation

- Add `file-route.ts` with `defineFileRoute`, `createFileRouteFactory`, the callable/resolved factory brands, and the flat/shared versus method-map contracts. Reuse the phase-8 middleware brands, requirement checks, event accessors, validation pipeline, response processing, and error machinery rather than fork them.
- Give every built file handler two projections: runtime schema/meta data for validation and OpenAPI, and a type-only normalized kernel method map for clients/codegen.
- Ride the `types:extend` hook upstream already fires ([nitro.ts:235](../../src/nitro.ts:235)). `collectRouteHandlers` ([nitro.ts:79](../../src/nitro.ts:79)) already knows each normalized path, import, and Nitro method lock; extend it to recognize dux file handlers and emit `#h3-dux/routes`.
- Keep graceful migration: inherited upstream `defineRouteHandler` and plain Nitro handlers continue to work and continue contributing to Nitro's own `InternalApi`/OpenAPI behavior, but only dux file handlers enter the generated h3-dux kernel map. An untyped route is omitted rather than assigned a fictional contract.
- Regenerate during prepare, dev add/remove/rename, and build. The generated public endpoint types must stay schema-free and retain the diagnostic-quality contract established in phase 5.
- Keep `@mszr/h3-dux/nitro` build-time only. Client code imports `createClient` from the root and the generated `Routes` type; no Nitro runtime or route implementation enters a browser bundle.

### Implementation order

1. **9A — shared route core.** Finish the canonical kernel and extract the standalone builder's validation/event/error/response execution into reusable internal functions. Existing standalone tests must stay green before file routing is added.
2. **9B — file-route authoring.** Implement `defineFileRoute`, flat/shared and method-map dispatch, then `createFileRouteFactory` with `.use()`/`.requires()`/`.compose()`. Lock runtime, type-shape, and editor diagnostics without Nitro codegen.
3. **9C — Nitro generation.** Teach the Nitro module to collect the dux handler brand, combine its method kernels with Nitro's normalized path/method table, and emit `#h3-dux/routes` plus the generated assertions.
4. **9D — lifecycle and moat proof.** Add dev regeneration, the full W5 fixture, update the Nitro demo to remove its hand-written route map, and verify OpenAPI/InternalApi coexistence with inherited and plain Nitro routes.

Each step leaves a testable surface and preserves one implementation of the route runtime. Codegen is a consumer of the handler kernel, never a second validator or dispatcher.

**Approach (delivered).**

- **9A — shared route core.** The per-method execution (validation mode, SSE, response-kind tagging, the dux event layer — `event.valid`/`event.error`/the root accessors) was extracted into `internal/runtime.ts`'s `buildMethod`, which returns upstream's per-method def (validate block + wrapped handler). `server.ts`'s `mount` and the file-route dispatcher both call it, so there is **one** route runtime. The kernel was finished in the same step: `DuxEndpoint` now *is* `{ request, responses, success }` and the client reads it (delta 7 reality, above) — existing standalone tests stayed green throughout.
- **9B — file-route authoring.** `file-route.ts` adds `defineFileRoute` (flat **and** method-map forms) and `createFileRouteFactory()` (`.use`/`.requires`/`.compose`). The flat form reuses `DuxVerbOpts` verbatim, typed for a body-bearing method at the route-free pattern `'/'`; the method-map form carries per-method validate/response/status/errors inference. The callable surface is one signature over a flat-or-methods argument branch, so the **bare-handler shorthand** (`defineFileRoute(e => …)`, and a factory's `f(e => …)`) adds no overload and malformed definitions stay cursor-local: excess flat keys, bad flat handler returns, and typo method keys are Selenita-locked as one diagnostic with no schema/kernel/overload leak. The factory is callable only while its `Requires` are empty (a call signature is intersected in conditionally), so an unresolved `.requires(...)` factory is a cursor "not callable" until `.compose`d — the file-route counterpart of router `.mount()`, sharing the phase-8 binding-collision/requirement checks. Runtime, type, and editor-DX planes all lock it.
- **9C — Nitro generation.** `internal/nitro-codegen.ts` holds the pure `generateRoutesModule` (unit-tested without Nitro): it maps each collected dux file route — Nitro's route table is the path/method truth — through the type-only `FlatContract`/`FileMethods`/`WithFilenameParams` helpers into one schema-free `#h3-dux/routes` entry, and rejects the runtime-inspectable contradictions (unreachable-method file, body-bearing shared handler, duplicate route+method). `nitro.ts` is now a real module: it imports each route file to read the handler's form markers, generates `#h3-dux/routes` on `types:extend`, writes it to `generatedTypesDir`, registers the import path in the generated tsconfig, and fails the build on a diagnostic.
- **9D — moat proof.** The Nitro demo's route files were ported to `defineFileRoute` and its client now reads `import type { Routes } from '#h3-dux/routes'` — the hand-written route interface is gone. `nitro prepare` generates the map, the demo typechecks end-to-end (verified: `api.get('/fruits/:id', { params })` is `Fruit`, missing-params / unknown-route are cursor errors), and a deliberately mis-suffixed file fails `prepare` with the focused diagnostic.

**Realities worth recording.**

- **The flat form registers under every method at runtime** so it self-dispatches for whichever method the filename routes; the `#h3-dux/routes` projection is driven by Nitro's table (not this registration), so a method-locked flat file still exposes only its locked method to the client.
- **The honest filename boundary holds.** With a `validate.params` schema the handler and client get the coerced type; without one the source type is `Record<string, string>` and codegen substitutes the exact filename params via `WithFilenameParams`. The generated declaration references `import('<file>').default` (the kernel is already resolved/schema-free), so it re-links to source on every regenerate rather than being flattened to literals.
- **Two coexistence items are deferred to a later pass (not blockers):** OpenAPI enrichment *for dux file routes* through the Nitro module (the handlers carry `~routeDef` schemas, so an overlay is straightforward, but a method-locked flat file would over-report methods until the registration is trimmed), and the generated params key-agreement *assertion* (`WithFilenameParams` already substitutes/keeps the right params; the extra shape-only cross-check is additive). Plain Nitro and inherited upstream handlers keep Nitro's default `$fetch`/OpenAPI and are omitted from the dux client map, as specified.

### Deferred intentionally

- **No special setup file.** Phase 9 does not reserve `dux.ts`, `h3-dux.ts`, or any project filename. File-route factories are ordinary project-owned server utilities.
- **No checked bridge to arbitrary global Nitro middleware.** A requirement is satisfied through typed factory composition, where both runtime registration and type evidence are visible.
- **No Nuxt-specific module, auto-import, `useDuxClient`, or app-side type bridge.** Nuxt 5 is not released; its final h3 v2/Nitro v3 integration surface is not a stable contract. Once released, a thin Nuxt adapter may consume this Nitro-native kernel and factory model without changing the phase-9 route API.
- **No pre-bound `#h3-dux/client`.** `createClient<Routes>()` is explicit, small, and sufficient. A convenience module must earn its extra surface through real usage.

**Status:** ☑ done (phase 9). Runtime, type, editor-DX, and generation planes are green; the Nitro demo is migrated and verified through `nitro prepare`.

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

- **Request-data access** — *settled (revised for phase 8).* `event.params/query/body` are root aliases over canonical `event.context` storage. Params resolve before the handler in both modes. Eager declared query/body schemas expose validated outputs directly; deferred manual scopes retain raw/`unknown` direct properties and expose their trusted output through the return of `event.valid()` only. Undeclared bodies remain `unknown` and undeclared queries retain their raw h3 shape. `event.validated` is not part of the dux surface.
- **Validation-error status** — *settled (revised for Gen 2).* Request-validation failures are **`422`, eager or manual** (delta 9) — Generation 1's `400`/`422`-by-mode split is gone, because a client must not see a different status for the same malformed request based on a server-internal mode choice. Response failures stay `500`; all carry `{ source, issues }`. A custom envelope is still a userland `onValidationError` ([dux-conventions.md §7](./dux-conventions.md#7-validation-errors)).
- **Verb coverage** — *settled.* The callable verbs (`get/post/put/patch/delete/head/options`) get verb methods; `trace`/`connect` stay on the underlying `app.native.route()`, matching upstream's `CallableMethod`.
- **Client default shape** — *settled.* The default is the honest `{ data, error }` result, not a bare value and not a Go tuple (delta 8). Honesty is the tiebreaker: a type that asserts `Fruit` but can reject is the cursor lying. `.orThrow()` is the legible opt-out; `.raw()` the web-standard escape hatch.
- **Typed errors: now, not later** — *settled.* The status→schema response map is preserved in the kernel from the start (delta 7), not deferred — because the response-contract shape decides whether errors, raw, Nitro, and OpenAPI stay coherent. The honest default *subsumes* a separate `api.try` surface (it already is the typed result), so we ship one mechanism, not three.
- **`params` placement** — *settled.* On the dux verb surface `params` is declared inside `validate` (one request block); it remains route-level underneath, where multi-method routes and grouped routers share one param schema ([dux-conventions.md §4](./dux-conventions.md#4-the-validated-data-model)).
- **Middleware state vocabulary** — *settled.* `staged` is private preparation for one middleware; `bindings` are request-scoped capabilities published downstream. Middleware returns keep h3 response semantics. No imperative setter and no single-letter event aliases.
- **File-route method ownership** — *settled.* Nitro's filename owns the method. A method-locked file uses flat `defineFileRoute({ handler, … })`; an unsuffixed file uses either a method-neutral shared handler or an explicit method map. There are no `defineFileRoute.get/post/…` methods.
- **File-route definition diagnostics** — *settled.* `defineFileRoute` and file-route factories use one callable signature for the flat and method-map authoring forms. The method-map branch captures only file-route authoring keys, so malformed flat objects and typo method keys do not collapse into an empty generated method map; they report at the cursor with the same no-overload/no-schema-leak bar as the rest of delta 6.
- **File-route capability boundary** — *settled.* Factories carry providers lexically. An unresolved `.requires()` factory is non-callable until a parent factory satisfies it through `.compose()`; arbitrary global Nitro middleware is not accepted as invisible type evidence.
- **Nuxt integration** — *deferred intentionally.* Phase 9 is Nitro-native and reserves no setup filename. A Nuxt adapter, auto-imports, and app-side client helpers are designed only after Nuxt 5 publishes its stable h3 v2/Nitro v3 integration contract.
