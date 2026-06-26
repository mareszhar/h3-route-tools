# h3-dux — conventions

The cross-cutting law: the words, the names, and the few rules that make every h3-dux surface feel like one library. [dux-vision.md](./dux-vision.md) principles 4 and 5 are the *why* — self-documenting, predictable, learn one and know the rest; this doc is the *what*.

Every name we add answers three questions: does it say what the thing **is** (not what an ancestor called it), is it **technically accurate**, and is it used **consistently** everywhere the concept appears? Where upstream or h3 core already has a precise word, we keep it — renaming for sport is its own kind of boilerplate.

- [0. House style](#0-house-style)
- [1. Vocabulary](#1-vocabulary)
- [2. The fetchdts alignment](#2-the-fetchdts-alignment)
- [3. Values vs types](#3-values-vs-types)
- [4. The validated-data model](#4-the-validated-data-model)
- [5. Server ↔ client symmetry](#5-server--client-symmetry)
- [6. Response typing](#6-response-typing)
- [7. Validation errors](#7-validation-errors)
- [8. The contract kernel](#8-the-contract-kernel)
- [9. The honest client](#9-the-honest-client)
- [10. Typed errors & results](#10-typed-errors--results)
- [11. Response kinds](#11-response-kinds)
- [12. Composition & scope](#12-composition--scope)
- [13. Typed middleware bindings](#13-typed-middleware-bindings)
- [14. The naming map](#14-the-naming-map)

---

## 0. House style

The style for every h3-dux doc.

- **Precise, not padded.** One concept, one term; synonyms signal different things. Use the technical word when the domain calls for it. Write to lower the reader's effort, not to sound thorough.
- **Decisions, not deliberations.** State the current answer, not the path to it. Imperative or declarative ("use X", "X is Y"), never "you might consider X".
- **Rationale earns its place.** Explain a choice when the reason is non-obvious or guards a known trap — otherwise let the rule stand clean. The two failure modes are equal: commentary that buries the rule, and terseness that makes it feel arbitrary.
- **No hedging.** Drop *generally*, *usually*, *try to* unless a real exception needs surfacing — then state it.
- **DRY.** Link to the canonical place instead of restating it. A fact lives in one doc; the others reference it.

### Name your schema outputs

A house convention for userland schemas, not a kit rule — but it costs nothing and directly serves principle 4. TypeScript expands an anonymous `v.InferOutput<typeof FruitSchema>` into its full mapped shape on every hover. Give it a name once and the hover collapses to that name:

```ts
export interface Fruit extends v.InferOutput<typeof FruitSchema> {}
```

Now `Fruit` reads as `Fruit` at the cursor instead of `{ id: string; emoji: string; … }`. The contract kernel ([§8](#8-the-contract-kernel)) does this on the *kit* side (it prettifies at the public boundary); this is its userland complement, and the demos and docs model it.

---

## 1. Vocabulary

These words carry exactly these meanings across the server, client, and Nitro surfaces.

| Term | Means |
| --- | --- |
| **route** | a path pattern (`/fruits/:id`); the unit you author and address |
| **method** | the HTTP verb on a route (`get`, `post`, …); a route has one contract per method |
| **endpoint** | a route + method pair — the addressable unit the client targets |
| **contract** | a method's full type: its `validate` block + handler return; what accumulates into `typeof app` |
| **validate block** | the `validate: { params, query, body, headers, response, eager? }` object on a method |
| **handler** | the function that runs for a method; receives the typed `event`, returns the response |
| **middleware** | h3 middleware, optionally carrying typed requirements and downstream bindings; how auth and cross-cutting concerns attach (never a kit concept) |
| **eager / manual** | the two validation modes — auto-run before the handler, or on-demand via `event.valid()` ([§4](#4-the-validated-data-model)) |
| **EventStream** | a response branded by `sse(schema)` — a typed `text/event-stream`, consumed as `AsyncGenerator<T>` |
| **endpoint contract / kernel** | the normalized, schema-free projection of an endpoint that every plane reads: `{ request, responses, success }` ([§8](#8-the-contract-kernel)) |
| **result** | what a default client call resolves to: `{ data, error }` — `data` on 2xx, a typed `error` otherwise ([§9](#9-the-honest-client)) |
| **DuxError** | the client-side failure: `DuxHTTPError` (a typed non-2xx response) or `DuxTransportError` (the request never completed) ([§10](#10-typed-errors--results)) |
| **response kind** | how a response body crosses the wire — `json \| text \| empty \| sse \| binary` ([§11](#11-response-kinds)) |
| **router** | a delta-carrying route group built with `createRouter`, optionally owning a literal prefix, then mounted into a server ([§12](#12-composition--scope)) |
| **staged values** | middleware-private preparation returned by `staged`; visible only to that middleware's `bindings` and `handler` callbacks ([§13](#13-typed-middleware-bindings)) |
| **bindings** | request-scoped values a typed middleware publishes to downstream middleware and handlers as `event.bindings` ([§13](#13-typed-middleware-bindings)) |
| **requirements** | middleware or parent-path capabilities that a middleware, router, or endpoint consumes without registering them again ([§12](#12-composition--scope), [§13](#13-typed-middleware-bindings)) |
| **file route** | a Nitro filesystem route whose path and optional method come from its filename, authored with `defineFileRoute` or a derived file-route factory ([spec §13](./dux-spec.md#13-nitro-deltas-via-codegen)) |
| **file-route factory** | a callable route definition utility created by `createFileRouteFactory`; it carries typed middleware capabilities into independently authored Nitro route files ([spec §13](./dux-spec.md#13-nitro-deltas-via-codegen)) |

`params`, `query`, `body`, `headers`, `response` keep their h3 / fetchdts meanings ([§2](#2-the-fetchdts-alignment)). Validated request values live canonically on `event.context` and are exposed through the root aliases `event.params`, `event.query`, and `event.body`; the client uses the same request names.

---

## 2. The fetchdts alignment

The typed client speaks [fetchdts](https://github.com/unjs/fetchdts) — the type-level vocabulary a Nuxt-core contributor is standardizing. We stay inside it so the client realigns cheaply if fetchdts ships more.

- Per-endpoint metadata keys are **`query`, `headers`, `body`, `response`, `responseHeaders`** — note it is **`response`, not `output`**.
- Paths are **string literals**, and dynamic segments are **template-literal** paths (`/fruits/${string}`). That is what lets interpolation (`api.get(\`/fruits/${id}\`)`, [delta 3](./dux-spec.md)) typecheck on the client.
- The client surface is **verb + literal path** (`api.get('/fruits/:id', …)`), not an Eden-style proxy chain.

---

## 3. Values vs types

- **Values are unprefixed:** `createServer`, `createClient`, `defineRoute`, `sse`. The package specifier already namespaces them; a userland clash is one `import { sse as sseStream }` away.
- **Types stay close to upstream and h3.** We re-export h3-route-tools' type names unchanged (`TypedFetch`, `Endpoint`, `RouteHandler`, …) — renaming them would only make diffing upstream harder. New types we introduce read plainly and domain-scoped (`EventStream<T>`); no vanity brand prefix.

The rule of thumb: **a re-exported name keeps its upstream spelling; a name we coin is chosen for precision.**

---

## 4. The validated-data model

How a handler reads request data — and the one place h3-dux deliberately improves on upstream's `event.validated` bag. The types describe what has actually been established, never what a client merely claimed:

- **Root aliases are the default read.** `event.params`, `event.query`, and `event.body` are getters over the same canonical values as `event.context.params/query/body`; there is one store and one type model, not two implementations.
- **Eager schemas produce direct typed values.** With the default eager mode, a declared scope is validated before the handler and both aliases expose the schema's output type.
- **Manual schemas are available through `event.valid(scope)`, not a premature property.** Under `eager: false`, a deferred `query`/`body`/`headers` schema does not make `event.query` or `event.body` claim the schema output before validation. The direct property remains raw/`unknown` for the handler; `await event.valid('body')` runs the schema, caches the value, returns its output type, and throws → `422` on failure. TypeScript cannot soundly narrow a separate property after an async method call, so use the returned value. In eager mode the same call returns the cached validated value.
- **Undeclared input stays raw.** A body with no schema is `unknown`; a query with no schema has h3's raw query shape rather than an application object inferred from wishful property access. Declaring a schema is what turns untrusted client input into a trusted application type.
- **Path-derived params are the narrow exception.** A literal route such as `/users/:id` proves that its local `id` exists as a `string`; a params schema may validate/coerce it to a different output. Params are resolved before the handler in both modes because routing already depends on them; manual mode controls query/body/headers. A child router only knows its own path plus parent params it explicitly declares ([§12](#12-composition--scope)).

A request-validation failure is **`422` regardless of mode** ([§7](#7-validation-errors)): the status a client sees must not depend on a server-internal mode choice (principle 5 — no surprises between siblings).

We **drop `event.validated`** from the surface — from the *types*, not just the docs. `event.valid('body')` reads as the deliberate action it is; eager direct reads use `event.body` (or its `event.context.body` alias). Upstream's accessor stays available underneath for diffing, but the dux `MethodEvent` does not expose it.

`eager: false` lives **inside the `validate` block**, next to the schemas it governs. So does `params`: on the dux verb surface `validate.params` is where you declare the param schema, so the whole request contract reads from one block — even though params are *route-level* underneath (one schema per path, shared across methods), which is where they live for multi-method routes and grouped routers ([§12](#12-composition--scope)). Full contract and the pipeline order: [dux-spec.md §5](./dux-spec.md).

---

## 5. Server ↔ client symmetry

The server verb you author and the client verb you call are the **same word**. This is principle 5 made literal:

```ts
app.get('/fruits/:id', { handler })        // authoring          (delta 1)
api.get('/fruits/:id', { params: { id } }) // calling            (delta 2)
```

`createServer` and `createClient` are named as counterparts for the same reason — one integrated system, read from both ends. The bare upstream forms (`.route({ … })`, `api(path, { method })`) stay valid; the verb forms are additive sugar.

### The bare-handler shorthand

When a route needs no options — no `validate`, `status`, `errors`, or `middleware` — pass the handler directly instead of `{ handler }`. It is sugar for the options form (defaults unchanged: eager validation, inferred response, inferred kind), and the response is still inferred from the return:

```ts
app.get('/health', e => ({ ok: true }))            // ≡ { handler: e => … }
createRouter('/ping').get('/', () => ok)           // routers too
export default defineFileRoute(e => listOrders())  // and Nitro file routes / factories
```

It is **one signature with a `options | handler` union parameter**, never a second overload — so a malformed options object still reports a single diagnostic at the offending property, never the "No overload matches this call" wall ([dux-spec.md §6](./dux-spec.md#6-cleaner-inference--diagnostics-as-contract)). The shorthand is for the defaults-only case; reach for `{ … }` the moment you need any option. (The client stays options-only: a call's `params`/`body`/`query` are data, not a callback.)

---

## 6. Response typing

Response typing is **hybrid**, and the default is zero-ceremony:

- **Inferred by default.** With no `validate.response`, the handler's return *is* the client's type. This is the Hono/Elysia parity that kills the hand-written `request<Receipt>(…)` assertion.
- **Validated on opt-in.** Declaring `validate.response` does two things: it type-checks the handler's return against the schema (it can't lie), and it runtime-validates the response before sending (→ `500` on a breach).
- **Streamed via `sse()`.** `sse(schema)` is the streaming form of `validate.response`: it brands the endpoint so the client returns `AsyncGenerator<T>` instead of a JSON body ([dux-spec.md §4](./dux-spec.md)).
- **Per-status when you want it.** `validate.response` accepts a status map (`{ 200: Fruit, 404: NotFound }`) and `errors` declares failure schemas — the success projection becomes `data`, the rest become a typed `error` ([§9](#9-the-honest-client), [§10](#10-typed-errors--results)).

Client response types are the **wire shape**: a `v.date()` / `z.date()` field arrives as `string`, because that is what JSON gives you. (Inherited from upstream's `Serialize`.) The *kind* of a response — JSON, plain text, empty (`204`), a stream, or binary — is part of the contract too, so the client decodes it correctly without a guess ([§11](#11-response-kinds)).

How that typed response is *consumed* — not asserted by hand, not behind a double `await` — is [§9](#9-the-honest-client).

---

## 7. Validation errors

We keep upstream's cascade verbatim — it is already excellent. One hook, `onValidationError`, receives `{ source, issues, event }` and runs at three cascading scopes (**method → route → app**, narrower wins). Return `ErrorDetails` to shape the response, or nothing for the default.

Two dux refinements to the defaults:

- **One status for request validation: `422`.** Request-validation failures are `422` (well-formed but semantically invalid), eager or manual, carrying `{ source, issues }`. Generation 1 inherited a `400`/`422` split by mode; that split is gone — a malformed request must not change status because the *handler* chose a validation mode ([§4](#4-the-validated-data-model)). Response-validation failures stay `500` — a server-side contract breach is never the caller's fault.
- **The error envelope is part of the contract.** Upstream auto-registers schemas for the failures it raises (`400`/`415`/`500`), and `errors: { … }` adds your own. Those schemas don't just feed OpenAPI — they flow into the kernel's `responses` map ([§8](#8-the-contract-kernel)), so the client's typed `error` already knows the validation-failure shape ([§10](#10-typed-errors--results)). One declaration, every consumer.

So h3-dux still adds no new *error-handling* concept — it inherits the cascade — but it stops throwing the error *types* away, and it makes the status predictable.

---

## 8. The contract kernel

Every plane that reads `typeof app` needs the same thing: an endpoint's *plain shapes* — what params it takes, what it returns per status, how the body crosses the wire. Today each plane re-derives that from the raw schema generics, which is why inferred types turn intricate and `ObjectSchema<…>` internals surface in diagnostics. The kernel computes it **once**, at accumulation time:

```ts
interface EndpointContract {
  request: { params: unknown, query: unknown, headers: unknown, body: unknown } // resolved shapes — no schema generics
  responses: Record<number, { body: unknown, kind: ResponseKind }> // per-status
  success: number // the 2xx status this endpoint answers with (200, 201, 204…)
}
```

Rules of the kernel:

- **Resolved, not schematic.** Members are the validated *output* shapes (wire-serialized for responses), prettified at the boundary. A consumer never sees `SchemaWithPipe<…>`; it sees `{ name: string; pricePerKg: number }`.
- **The schema stays the source of truth.** The kernel is its public *projection*, not a replacement — runtime validation still runs off the original schema. One concept, one source ([dux-vision.md §3](./dux-vision.md#3-design-principles), principle 2).
- **Per-status, never flattened.** `responses` keeps each status distinct. Generation 1 collapsed a status map to a single union, discarding exactly the discrimination the client's error channel needs ([§10](#10-typed-errors--results)).
- **Every plane consumes it.** Client types, diagnostics, composition merges, Nitro codegen, and OpenAPI all read the kernel — so a fix to the projection lands everywhere at once, and the planes can't drift.

The kernel is internal — no user writes one. Its payoff is felt indirectly: cleaner inference, honest errors, and surfaces that agree.

---

## 9. The honest client

A default client call resolves to a **result**, not a bare value:

```ts
const { data, error } = await api.get('/fruits/:id', { params: { id } })
if (error)
  return handle(error) // error: DuxError — you must deal with it
data // Fruit — narrowed only after error is cleared
```

Why this is the default, not `const data = await api.get(...)`: the terser form is *convenient but dishonest*. It types `data` as `Fruit` while hiding two runtime realities — the transport can fail, and the server can answer with an error status. A type that asserts success but can reject is the cursor lying (principle 3). The result form makes both outcomes visible, so you handle them at the cursor or *deliberately* choose not to.

Three consumption modes hang off the **call handle** — one mechanism, no parallel namespaces (the handle already overloads `await` vs `for await` for SSE):

| Call | Resolves to | When |
| --- | --- | --- |
| `await api.get(path, opts)` | `{ data, error }` | the default — honest about failure |
| `await api.get(path, opts).orThrow()` | `Data` (throws `DuxError`) | you *want* it to bubble (scripts, SSR loaders, server-to-server) |
| `await api.get(path, opts).raw()` | `DuxRawResponse<Data, Kind>` | native status/headers plus kind-aware `.parse()` |
| `for await (… of api.get(path, opts))` | `AsyncGenerator<T>` | an `sse()` endpoint, unchanged |

`.orThrow()` keeps the one-liner for cases where bubbling is correct — but you have to *name* the choice to discard the error, which reads as the decision it is (Go's `_`, made legible). `.raw()` never throws on a non-2xx; it hands you the native `Response` to inspect, augmented with one method: `.parse()` returns the endpoint's inferred body whether it is JSON, text, binary, or empty. The standard `.json()`/`.text()`/`.blob()` methods remain available; `.json()` is typed as the body only for an actual JSON endpoint.

This **subsumes** a separate "typed result" surface (Elysia Treaty's `api.try`): the honest default *is* the typed result, so there is one shape to learn, not three. It also kills Generation 1's double-`await` (`await (await api.get()).json()`) and the lie where `.json()` was typed as the success body even on a `404`.

The result is an object (`{ data, error }`), not a Go tuple (`[error, data]`): TypeScript narrows a destructured discriminated *object* reliably (`if (error) return; data` works), and a tuple far less so. Since the whole point is cursor-level honesty, we pick the form the compiler narrows best.

---

## 10. Typed errors & results

`error` in a result is a discriminated `DuxError`:

```ts
type DuxError
  = | { kind: 'http', status: number, data: unknown, response: Response } // server answered non-2xx; data is typed per status
    | { kind: 'transport', cause: unknown } // request never completed
```

- **`kind` separates the two failures you can't conflate.** A `404` is not a dropped connection; only one carries a server payload.
- **`status` discriminates the HTTP error**, and `data` narrows with it — sourced from the kernel's `responses` map ([§8](#8-the-contract-kernel)). Given `errors: { 409: ConflictSchema }`, `if (error?.status === 409) error.data` is `Conflict`.
- **It degrades gracefully.** An endpoint that declares no error schemas still returns `{ data, error }`; there `error.data` is just the default envelope (`{ source, issues }` for validation, `unknown` otherwise). Honesty holds everywhere; typing *sharpens* wherever the contract declares it — never adding ceremony where it doesn't (principle 9).

On the server, errors are declared and thrown with the same vocabulary they're consumed:

```ts
app.post('/fruits', {
  validate: { body: NewFruitSchema, response: FruitSchema },
  errors: { 409: ConflictSchema }, // feeds runtime validation + client types + OpenAPI
  handler: (e) => {
    if (orchard.has(e.context.body.name))
      throw e.error(409, { reason: 'already_exists' }) // checked against ConflictSchema, at the cursor
    return orchard.create(e.context.body)
  },
})
```

`event.error(status, data)` is the typed thrower: `status` must be a declared error status, and `data` is checked against that status's schema — the inverse of the client's typed `error`, closing the loop. For SSE, a mid-stream `DuxError` surfaces as a throw from the async iterator, so `for await` can `try/catch` it.

One declaration of `errors`/`response` feeds four consumers — runtime validation, client `data`/`error` types, `event.error`, and OpenAPI. That is the three-for-one (here four) that puts h3-dux at or past Elysia Treaty while staying on Standard Schema.

---

## 11. Response kinds

Not every response is JSON. The kernel tags each status's body with a **kind** so the client decodes it correctly and the type reflects reality:

| Kind | Wire | Client sees |
| --- | --- | --- |
| `json` | `application/json` | the serialized output shape (default) |
| `text` | `text/plain` | `string` |
| `empty` | no body (`204`, some `HEAD`) | `void` / `undefined` |
| `sse` | `text/event-stream` | `AsyncGenerator<T>` ([§6](#6-response-typing)) |
| `binary` | `Blob`/stream | `Blob` |

The common case needs nothing. Objects are `json`, strings are `text`, Blob/bytes/streams are `binary`, and `void`/`null`/`undefined`, `204`/`205`, and `HEAD` are `empty`. The status-aware contract rejects a body-returning `204`/`205`/`HEAD` handler at the cursor. `text()` and `binary()` remain available only as explicit overrides for an ambiguous schema; `sse(schema)` carries the streaming schema and kind.

Kind and MIME are separate concepts. The server infers the runtime kind from the actual handler value and carries it as a standards-valid `dux-kind` parameter on `Content-Type`; the media type remains the real format (`text/csv`, `image/png`, and so on). Thus a CSV Blob stays a `Blob` rather than becoming a string merely because its MIME starts with `text/`.

A plain native `Response` passes through unchanged and stays body-opaque (`unknown`) because the platform type carries no body generic. When the body should remain typed, construct the same web-standard object with `typedResponse(data, init)`: strings, JSON values, binary bodies, and empty responses are inferred, and the client sees the body through the default result, `.orThrow()`, and `.raw().parse()` alike.

---

## 12. Composition & scope

A server is authored by chaining (`createServer().get(…).post(…)`), and the accumulated `typeof app` is the source of truth. That doesn't scale to many files — so domains compose through **routers**:

```ts
// fruits.routes.ts — a domain module, no server, deltas intact
export const fruits = createRouter('/fruits')
  .get('/:id', { validate: { response: FruitSchema }, handler: e => orchard.get(e.params.id) })
  .post('/', { status: 201, validate: { body: NewFruitSchema }, handler: e => orchard.create(e.body) })

// app.ts — aggregate; each router already carries its domain prefix
export const app = createServer()
  .mount(fruits)
  .mount(checkout)
export type App = typeof app
```

The rules that make composition trustworthy:

- **Routers carry the deltas.** A `createRouter` group is *delta-aware* — verb authoring, validation modes, `sse()`, response/param inference, typed errors, and typed middleware bindings — so splitting a domain into its own file never drops you back to upstream ergonomics. (Composing via upstream's `defineRoute`/`mountRoutes` still works and still accumulates; the router is the form that keeps the deltas.)
- **A router owns its domain prefix.** `createRouter('/users/:userId')` carries that literal in its type, so every child handler knows `userId` and a hover over the router reveals the path it owns. `createRouter()` remains the prefix-free form.
- **`mount(router)` merges the router as declared.** `mount('/v1', router)` may add a static outer prefix for versioning or deployment structure; the client still sees one flat route map. This is Hono's `app.route(prefix, sub)` / Elysia's `.group` parity with the domain prefix kept beside the domain definition.
- **Dynamic params should normally be owned where they are consumed.** Prefer `createRouter('/users/:userId/friends')` when its handlers read `userId`. A dynamic outer mount cannot retroactively contextualize an already-authored router. For the uncommon case where the enclosing router must own that segment, use `createRouter('/friends', { parentParams: ['userId'] })` and mount it at `/users/:userId`; `.mount()` checks the requirement. Missing names and duplicate parent/local param names are cursor diagnostics. When validation or coercion is required, the endpoint's params schema describes the combined parent + owned + local shape and wins over string inference.
- **Accumulation requires chaining.** `app.get(); app.get();` as separate statements loses the accumulated type — an industry-wide constraint (Hono and Elysia share it). The *escape* from a giant chain is exactly the router/`mount` split above; we say so rather than letting it surprise.
- **Duplicate route+method is a diagnostic, not silent first-wins.** Defining the same endpoint twice is almost always a mistake; the builder surfaces it at the cursor.
- **The native escape hatch is `.native`.** The underlying `H3Typed` is reachable as `app.native` (renamed from `.app` for clarity); routes added through it accumulate into the dux contract via `.register`, so the escape hatch doesn't silently desync the client's type.

---

## 13. Typed middleware bindings

Middleware keeps ordinary h3 semantics: it can continue, intercept, redirect, throw, or post-process a response. Typed bindings add one optional capability without redefining what middleware is:

```ts
const withUser = defineMiddleware({
  staged: event => ({
    session: readSession(event),
    token: event.req.headers.get('authorization'),
  }),
  bindings: event => ({
    user: authenticate(event.staged.session, event.staged.token),
  }),
  async handler(event, next) {
    if (event.bindings.user.suspended)
      return redirect('/account-suspended')
    return next()
  },
})

app.use(withUser).get('/me', { handler: event => event.bindings.user })
```

After type requirements are satisfied, preparation happens before the middleware handler:

```text
staged → bindings → handler(event, next)
```

h3 middleware is onion-shaped, not parallel. `next` is an argument controlled by the handler: it may never call it and intercept the request, return it directly, or await it and continue afterward. The full flow when it is awaited is:

```text
staged
→ bindings
→ handler before next()
→ downstream middleware / route
→ handler after await next()
```

Bindings are established before the handler can pass control downstream.

The model:

- **`staged` prepares private values.** Its returned object is inferred and exposed as `event.staged` to that middleware's `bindings` and `handler` callbacks. It does not enter the router's accumulated type and is hidden while downstream middleware/handlers run. Its canonical temporary storage is `event.context.staged`; h3-dux restores any enclosing staged scope across `next()`.
- **`bindings` publishes downstream capabilities.** Its returned object is inferred, merged into the request's bindings, and exposed as `event.bindings` to the middleware handler and everything downstream. Canonical storage is `event.context.bindings`; the root property is the delightful default.
- **Bindings are mutable within one request, not across contracts or requests.** Code may update an existing key with an assignable value (`event.bindings.user = refreshedUser`). A mutation made before `next()` is visible to later middleware and the endpoint on that request; a mutation made by the endpoint or inner middleware is visible to outer middleware after `await next()`. It does not alter another request, publish a new key, or change which bindings other routes are typed to receive.
- **There is no imperative binding setter.** Arbitrary mutation cannot yield a sound outgoing type. Reusable logic belongs in `staged`; the `bindings` return object is both the implementation and the inferred public contract.
- **`handler` retains full h3 behavior.** It receives the staged values, inherited plus newly published bindings, and `next`. Omitting it means “publish bindings, then continue.”
- **`.use((event, next) => …)` is the smallest inline form.** Inside `.use(...)` — which h3-dux controls — a bare callback needs no `defineMiddleware` wrap; its `event` is typed against the chain's accumulated bindings (so `event.bindings` reads what earlier middleware published) and it publishes nothing. `defineMiddleware(fn)` is for middleware defined *outside* `.use` and then passed in; the two share one runtime path, so the wrap is never required just to satisfy `.use`. (This mirrors the route verbs' bare-handler shorthand, [§5](#5-server--client-symmetry).)
- **Reusable and inline middleware share one object shape.** `app.use({ staged, bindings, handler })` is equivalent to defining that object separately with `defineMiddleware` and then using it. The inline form additionally receives the chain's current bindings automatically; a `requires` list may document and check specific capability dependencies.
- **Requirements consume; middleware registers.** `middleware: [withUser]` on an endpoint or `.use(withUser)` on a router registers and executes it there. `requires: [withUser]` executes nothing: it states that an enclosing scope must already provide the middleware's bindings. Requirements are checked at the route or mount cursor.
- **Routers may depend on their parent without importing the parent app.** `createRouter().requires(withUser)` types its handlers with `user` and records an external requirement; `.mount()` rejects a parent that has not already provided it.
- **Binding providers do not overwrite one another.** If two middleware in a `.use()` chain or endpoint `middleware` tuple both publish the same key, registration fails at the cursor—even when their value types happen to agree. A `requires` list publishes nothing and therefore cannot collide; it only checks that the capability already exists. Runtime assignment to an existing key is the separate, request-local mutation described above.
- **Runtime and type scope are distinguished.** h3 `app.use()` middleware is runtime-global even though chained TypeScript inference becomes available only after the call. For exact domain scope, own the middleware in a child router; for one endpoint, use its `middleware` key.
- **Auth is still not a concept.** A binding may be a user, tenant, database handle, request id, feature set, or anything else request-scoped. `defineMiddleware` only describes middleware capabilities.
- **Plain h3 middleware still works untyped.** An existing `(event, next) => …` contributes no bindings and pays no generic cost (principle 9).

The public event layout follows the same separation:

```ts
event.req
event.url
event.res
event.app
event.runtime
event.waitUntil()
event.valid()
event.error()

event.params
event.query
event.body
event.bindings

event.context // canonical h3-compatible storage and escape hatch
```

There are no single-letter aliases. The first-class names are already concise and remain self-documenting.

---

## 14. The naming map

Every name h3-dux coins or renames, with the upstream / standard term it maps to and why. New names are settled here once; the spec references this table rather than re-justifying each.

| h3-dux | Upstream / standard | Why |
| --- | --- | --- |
| `createServer()` | `new H3Typed()` | counterpart of `createClient`; factory reads better than `new`; self-documents "this is the server" |
| `createClient<App>()` | `createTypedFetch<App>()` | counterpart of `createServer`; "client" says what it is at the call site |
| `defineRoute` | `defineRoute` (kept) | already precise and converging with [h3 core](https://github.com/h3js/h3/issues/1088) |
| `app.get(path, opts)` | `.route({ route, get })` | verb authoring; mirrors the client and the HTTP method |
| `api.get(path, opts)` | `api(path, { method: 'get' })` | verb sugar; symmetric with the server |
| `sse(schema)` | — (new) | brands a `validate.response` as a typed `EventStream`; the `sse` response kind ([§11](#11-response-kinds)) |
| `text()` / `binary()` | — (new) | explicit kind overrides for an ambiguous response schema; ordinary strings/Blobs infer automatically ([§11](#11-response-kinds)) |
| `typedResponse(data, init?)` | `new Response(body, init)` | constructs a real native `Response` while carrying its inferred body contract end-to-end |
| `validate: { eager: false }` | — (new) | switches the validation pipeline to manual/on-demand |
| `event.valid('scope')` | — (new) | deliberate, idempotent validator; Hono `c.req.valid()` parity ([§4](#4-the-validated-data-model)) |
| `event.params/query/body` | `event.context.<scope>` | root getters over the same canonical request values; direct types stay honest across eager/manual modes ([§4](#4-the-validated-data-model)) |
| `{ data, error }` | — (new) | the honest default result; `data` on 2xx, typed `error` otherwise ([§9](#9-the-honest-client)) |
| `.orThrow()` | ofetch `$fetch` (throws) | legible opt-out: bubble the error instead of returning it |
| `.raw()` | ofetch `.raw` | native response metadata plus kind-aware `.parse()`; never throws on non-2xx |
| `errors: { 409: … }` | upstream `errors` (kept, widened) | per-status failure schemas in the contract; feeds client + runtime + OpenAPI ([§10](#10-typed-errors--results)) |
| `event.error(status, data)` | `HTTPError` / `createError` | typed thrower checked against the declared `errors` schema |
| `createRouter(prefix?, options?)` | `defineRoute` + `register` | delta-carrying composition unit; an optional literal prefix belongs to the domain and participates in param inference ([§12](#12-composition--scope)) |
| `app.mount(router)` / `app.mount(outerPrefix, router)` | `H3.mount` / `app.register` | merge a router as declared, optionally adding an outer prefix |
| `app.native` | `DuxServer.app` (renamed) | the underlying `H3Typed` escape hatch; clearer than `.app` |
| `defineMiddleware(fn \| options)` | h3 `Middleware` | ordinary middleware plus optional `staged` preparation, downstream `bindings`, and checked `requires` ([§13](#13-typed-middleware-bindings)) |
| `event.bindings` | `event.context.bindings` | request-scoped capabilities published by typed middleware |
| `event.staged` | `event.context.staged` | temporary values private to one middleware's `bindings`/`handler` lifecycle |
| `.requires(provider)` / `requires: […]` | — (new) | consume already-registered middleware capabilities without executing the middleware again |
| `defineFileRoute(def)` | Nitro `defineHandler` / upstream `defineRouteHandler` | route-free dux handler whose path and optional method come from the Nitro filename; carries the kernel and phase-8 event model ([spec §13](./dux-spec.md#13-nitro-deltas-via-codegen)) |
| `createFileRouteFactory()` | — (new) | derive reusable file-route definers with typed middleware providers and requirements |
| `factory.compose(feature)` | router `.mount()` | satisfy a feature factory's external capabilities and return a callable file-route factory without re-running required middleware |
| `#h3-dux/routes` | Nitro generated route types | generated, type-only kernel route map consumed by `createClient<Routes>()` |

Everything not in this table is re-exported from h3-route-tools **unchanged** — that is the default, and it is what keeps the fork diffable ([dux-vision.md §7](./dux-vision.md#7-how-h3-dux-stays-alive)).
