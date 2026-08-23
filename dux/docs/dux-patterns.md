# h3-dux — patterns

The cross-cutting law: the few behavioral rules that make every h3-dux surface work the same way, regardless of which file or plane you're reading. [dux-vision.md](./dux-vision.md) principles 2, 3, and 5 are the *why* — boilerplate is harm, errors belong at the cursor, learn one surface and know the rest; this doc is the *what*. The words these patterns are described in — vocabulary, naming, doc style — live in [dux-language.md](./dux-language.md).

Each pattern is a contract every plane (server, client, Nitro, OpenAPI) honors identically. [dux-spec-sdk.md](./dux-spec-sdk.md) is where each pattern was introduced as a delta; this doc is where the settled rule lives once it has shipped, so a later delta references it instead of re-deriving it.

- [1. The validated-data model](#1-the-validated-data-model)
- [2. Server ↔ client symmetry](#2-server--client-symmetry)
- [3. Response typing](#3-response-typing)
- [4. Validation errors](#4-validation-errors)
- [5. The contract kernel](#5-the-contract-kernel)
- [6. The honest client](#6-the-honest-client)
- [7. Typed errors & results](#7-typed-errors--results)
- [8. Response kinds](#8-response-kinds)
- [9. Composition & scope](#9-composition--scope)
- [10. Typed middleware bindings](#10-typed-middleware-bindings)

---

## 1. The validated-data model

How a handler reads request data. The types describe what has actually been established, never what a client merely claimed:

- **Root aliases are the default read.** `event.params`, `event.query`, and `event.body` are getters over the same canonical values as `event.context.params/query/body`; there is one store and one type model, not two implementations.
- **Eager schemas produce direct typed values.** With the default eager mode, a declared scope is validated before the handler and both aliases expose the schema's output type.
- **Manual schemas are available through `event.valid(scope)`, not a premature property.** Under `eager: false`, a deferred `query`/`body`/`headers` schema does not make `event.query` or `event.body` claim the schema output before validation. The direct property remains raw/`unknown` for the handler; `await event.valid('body')` runs the schema, caches the value, returns its output type, and throws → `422` on failure. TypeScript cannot soundly narrow a separate property after an async method call, so use the returned value. In eager mode the same call returns the cached validated value.
- **Undeclared input stays raw.** A body with no schema is `unknown`; a query with no schema has h3's raw query shape rather than an application object inferred from wishful property access. Declaring a schema is what turns untrusted client input into a trusted application type.
- **Path-derived params are the narrow exception.** A literal route such as `/users/:id` proves that its local `id` exists as a `string`; a params schema may validate/coerce it to a different output. Params are resolved before the handler in both modes because routing already depends on them; manual mode controls query/body/headers. A child router only knows its own path plus parent params it explicitly declares ([§9](#9-composition--scope)).

A request-validation failure is **`422` regardless of mode** ([§4](#4-validation-errors)): the status a client sees must not depend on a server-internal mode choice (principle 5 — no surprises between siblings).

We **drop `event.validated`** from the surface — from the *types*, not just the docs. `event.valid('body')` reads as the deliberate action it is; eager direct reads use `event.body` (or its `event.context.body` alias). The dux `MethodEvent` does not expose a second validated-data bag.

`eager: false` lives **inside the `validate` block**, next to the schemas it governs. So does `params`: on the dux verb surface `validate.params` is where you declare the param schema, so the whole request contract reads from one block — even though params are *route-level* underneath (one schema per path, shared across methods), which is where they live for multi-method routes and grouped routers ([§9](#9-composition--scope)). Full contract and the pipeline order: [dux-spec-sdk.md §5](./dux-spec-sdk.md).

---

## 2. Server ↔ client symmetry

The server verb you author and the client verb you call are the **same word**. This is principle 5 made literal:

```ts
app.get('/fruits/:id', { handler })        // authoring          (delta 1)
api.get('/fruits/:id', { params: { id } }) // calling            (delta 2)
```

`createServer` and `createClient` are named as counterparts for the same reason — one integrated system, read from both ends. The bare baseline forms (`.route({ … })`, `api(path, { method })`) stay valid; the verb forms are the delightful default.

### The bare-handler shorthand

When a route needs no options — no `validate`, `status`, `errors`, or `middleware` — pass the handler directly instead of `{ handler }`. It is sugar for the options form (defaults unchanged: eager validation, inferred response, inferred kind), and the response is still inferred from the return:

```ts
app.get('/health', e => ({ ok: true }))            // ≡ { handler: e => … }
createRouter('/ping').get('/', () => ok)           // routers too
export default defineFileRoute(e => listOrders())  // and Nitro file routes / factories
```

It is **one signature with a `options | handler` union parameter**, never a second overload — so a malformed options object still reports a single diagnostic at the offending property, never the "No overload matches this call" wall ([dux-spec-sdk.md §6](./dux-spec-sdk.md#6-cleaner-inference--diagnostics-as-contract)). The shorthand is for the defaults-only case; reach for `{ … }` the moment you need any option. (The client stays options-only: a call's `params`/`body`/`query` are data, not a callback.)

---

## 3. Response typing

Response typing is **hybrid**, and the default is zero-ceremony:

- **Inferred by default.** With no `validate.response`, the handler's return *is* the client's type. This is the Hono/Elysia parity that kills the hand-written `request<Receipt>(…)` assertion.
- **Validated on opt-in.** Declaring `validate.response` does two things: it type-checks the handler's return against the schema (it can't lie), and it runtime-validates the response before sending (→ `500` on a breach).
- **Streamed via `sse()`.** `sse(schema)` is the streaming form of `validate.response`: it brands the endpoint so the client returns `AsyncGenerator<T>` instead of a JSON body ([dux-spec-sdk.md §4](./dux-spec-sdk.md)).
- **Per-status when you want it.** `validate.response` accepts a status map (`{ 200: Fruit, 404: NotFound }`) and `errors` declares failure schemas — the success projection becomes `data`, the rest become a typed `error` ([§6](#6-the-honest-client), [§7](#7-typed-errors--results)).

Client response types are the **wire shape**: a `v.date()` / `z.date()` field arrives as `string`, because that is what JSON gives you. The *kind* of a response — JSON, plain text, empty (`204`), a stream, or binary — is part of the contract too, so the client decodes it correctly without a guess ([§8](#8-response-kinds)).

How that typed response is *consumed* — not asserted by hand, not behind a double `await` — is [§6](#6-the-honest-client).

---

## 4. Validation errors

h3-dux owns a single validation-error cascade. One hook, `onValidationError`, receives `{ source, issues, event }` and runs at three cascading scopes (**method → route → app**, narrower wins). Return `ErrorDetails` to shape the response, or nothing for the default.

Two dux refinements to the defaults:

- **One status for request validation: `422`.** Request-validation failures are `422` (well-formed but semantically invalid), eager or manual, carrying `{ source, issues }`. Generation 1 inherited a `400`/`422` split by mode; that split is gone — a malformed request must not change status because the *handler* chose a validation mode ([§1](#1-the-validated-data-model)). Response-validation failures stay `500` — a server-side contract breach is never the caller's fault.
- **The error envelope is part of the contract.** Upstream has auto schemas for failures it raises, but dux projects request validation as its runtime `422` envelope; `errors: { … }` adds your own. Those schemas don't just feed OpenAPI — they flow into the kernel's `responses` map ([§5](#5-the-contract-kernel)), so the client's typed `error` already knows the validation-failure shape ([§7](#7-typed-errors--results)). One declaration, every consumer.

So h3-dux adds no new *error-handling* concept beyond the cascade, but it keeps the error *types* and makes the status predictable.

---

## 5. The contract kernel

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
- **Per-status, never flattened.** `responses` keeps each status distinct. Generation 1 collapsed a status map to a single union, discarding exactly the discrimination the client's error channel needs ([§7](#7-typed-errors--results)).
- **Every plane consumes its rules.** Client types, diagnostics, composition merges, and Nitro codegen read the kernel directly; OpenAPI uses the same status/error/kind rules while reading runtime schemas for JSON Schema emission. A fix to the projection still lands everywhere without pretending a type-only kernel can replace runtime documentation data.

The kernel is internal — no user writes one. Its payoff is felt indirectly: cleaner inference, honest errors, and surfaces that agree.

---

## 6. The honest client

A default client call resolves to a **result**, not a bare value:

```ts
const { data, error } = await api.get('/fruits/:id', { params: { id } })
if (error)
  return handle(error) // error: H3DuxError — you must deal with it
data // Fruit — narrowed only after error is cleared
```

Why this is the default, not `const data = await api.get(...)`: the terser form is *convenient but dishonest*. It types `data` as `Fruit` while hiding two runtime realities — the transport can fail, and the server can answer with an error status. A type that asserts success but can reject is the cursor lying (principle 3). The result form makes both outcomes visible, so you handle them at the cursor or *deliberately* choose not to.

Three consumption modes hang off the **call handle** — one mechanism, no parallel namespaces (the handle already overloads `await` vs `for await` for SSE):

| Call | Resolves to | When |
| --- | --- | --- |
| `await api.get(path, opts)` | `{ data, error }` | the default — honest about failure |
| `await api.get(path, opts).orThrow()` | `Data` (throws `H3DuxError`) | you *want* it to bubble (scripts, SSR loaders, server-to-server) |
| `await api.get(path, opts).raw()` | `H3DuxRawResponse<Data, Kind>` | native status/headers plus kind-aware `.parse()` |
| `for await (… of api.get(path, opts))` | `AsyncGenerator<T>` | an `sse()` endpoint, unchanged |

`.orThrow()` keeps the one-liner for cases where bubbling is correct — but you have to *name* the choice to discard the error, which reads as the decision it is (Go's `_`, made legible). `.raw()` never throws on a non-2xx; it hands you the native `Response` to inspect, augmented with one method: `.parse()` returns the endpoint's inferred body whether it is JSON, text, binary, or empty. The standard `.json()`/`.text()`/`.blob()` methods remain available; `.json()` is typed as the body only for an actual JSON endpoint.

This **subsumes** a separate "typed result" surface (Elysia Treaty's `api.try`): the honest default *is* the typed result, so there is one shape to learn, not three. It also kills Generation 1's double-`await` (`await (await api.get()).json()`) and the lie where `.json()` was typed as the success body even on a `404`.

The result is an object (`{ data, error }`), not a Go tuple (`[error, data]`): TypeScript narrows a destructured discriminated *object* reliably (`if (error) return; data` works), and a tuple far less so. Since the whole point is cursor-level honesty, we pick the form the compiler narrows best.

---

## 7. Typed errors & results

`error` in a result is the **actual class the client returns and throws** — never a structural look-alike. The type *is* the runtime value, so principle 3 holds all the way down: the documented `H3DuxError` union of two `Error` subclasses, discriminated by `kind`.

```ts
type H3DuxError = H3DuxHTTPError<Status, Data> | H3DuxTransportError
//                 server answered non-2xx       request never completed
```

So a verb call over `errors: { 409: ConflictSchema }` hovers as `H3DuxHTTPError<409, Conflict> | H3DuxTransportError` — plain, web-standard, no `Result<…>`/`ClientError<…>` wrapper.

- **`kind` separates the two failures you can't conflate.** A `404` is not a dropped connection; only one carries a server payload (and `instanceof H3DuxHTTPError` works, because it is one).
- **`status` narrows the body directly — no `kind` guard first.** `status` is the literal code on an HTTP error and `undefined` on a transport one, so it discriminates the *whole* union: `if (error?.status === 409) error.data` is `Conflict`, even though the transport failure is still in the union. That is Elysia Treaty's one-condition ergonomic — but Treaty buys it by dropping network failures from the union (they throw); h3-dux keeps them, honest. `data` is sourced from the kernel's `responses` map ([§5](#5-the-contract-kernel)).
- **It degrades gracefully.** An endpoint that declares no error schemas still returns `{ data, error }`; there `error` is `H3DuxHTTPError<number, unknown> | H3DuxTransportError` and `error.data` is just the default envelope (`{ source, issues }` for validation, `unknown` otherwise). Honesty holds everywhere; typing *sharpens* wherever the contract declares it — never adding ceremony where it doesn't (principle 9).

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

`event.error(status, data)` is the typed thrower: `status` must be a declared error status, and `data` is checked against that status's schema — the inverse of the client's typed `error`, closing the loop. For SSE, a mid-stream `H3DuxError` surfaces as a throw from the async iterator, so `for await` can `try/catch` it.

One declaration of `errors`/`response` feeds four consumers — runtime validation, client `data`/`error` types, `event.error`, and OpenAPI. That is the three-for-one (here four) that puts h3-dux at or past Elysia Treaty while staying on Standard Schema.

---

## 8. Response kinds

Not every response is JSON. The kernel tags each status's body with a **kind** so the client decodes it correctly and the type reflects reality:

| Kind | Wire | Client sees |
| --- | --- | --- |
| `json` | `application/json` | the serialized output shape (default) |
| `text` | `text/plain` | `string` |
| `empty` | no body (`204`, some `HEAD`) | `void` / `undefined` |
| `sse` | `text/event-stream` | `AsyncGenerator<T>` ([§3](#3-response-typing)) |
| `binary` | `Blob`/stream | `Blob` |

The common case needs nothing. Objects are `json`, strings are `text`, Blob/bytes/streams are `binary`, and `void`/`null`/`undefined`, `204`/`205`, and `HEAD` are `empty`. The status-aware contract rejects a body-returning `204`/`205`/`HEAD` handler at the cursor. `text()` and `binary()` remain available only as explicit overrides for an ambiguous schema; `sse(schema)` carries the streaming schema and kind.

Kind and MIME are separate concepts. The server infers the runtime kind from the actual handler value and carries it as a standards-valid `dux-kind` parameter on `Content-Type`; the media type remains the real format (`text/csv`, `image/png`, and so on). Thus a CSV Blob stays a `Blob` rather than becoming a string merely because its MIME starts with `text/`.

A plain native `Response` passes through unchanged and stays body-opaque (`unknown`) because the platform type carries no body generic. When the body should remain typed, construct the same web-standard object with `typedResponse(data, init)`: strings, JSON values, binary bodies, and empty responses are inferred, and the client sees the body through the default result, `.orThrow()`, and `.raw().parse()` alike.

---

## 9. Composition & scope

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

- **Routers carry the deltas.** A `createRouter` group is *delta-aware* — verb authoring, validation modes, `sse()`, response/param inference, typed errors, and typed middleware bindings — so splitting a domain into its own file keeps the full h3-dux ergonomics. Baseline `defineRoute`/`mountRoutes` still work and still accumulate; routers are the form that keeps every dux delta.
- **A router owns its domain prefix.** `createRouter('/users/:userId')` carries that literal in its type, so every child handler knows `userId` and a hover over the router reveals the path it owns. `createRouter()` remains the prefix-free form.
- **`mount(router)` merges the router as declared.** `mount('/v1', router)` may add a static outer prefix for versioning or deployment structure; the client still sees one flat route map. This is Hono's `app.route(prefix, sub)` / Elysia's `.group` parity with the domain prefix kept beside the domain definition.
- **Dynamic params should normally be owned where they are consumed.** Prefer `createRouter('/users/:userId/friends')` when its handlers read `userId`. A dynamic outer mount cannot retroactively contextualize an already-authored router. For the uncommon case where the enclosing router must own that segment, use `createRouter('/friends', { parentParams: ['userId'] })` and mount it at `/users/:userId`; `.mount()` checks the requirement. Missing names and duplicate parent/local param names are cursor diagnostics. When validation or coercion is required, the endpoint's params schema describes the combined parent + owned + local shape and wins over string inference.
- **Accumulation requires chaining.** `app.get(); app.get();` as separate statements loses the accumulated type — an industry-wide constraint (Hono and Elysia share it). The *escape* from a giant chain is exactly the router/`mount` split above; we say so rather than letting it surprise.
- **Duplicate route+method is a diagnostic, not silent first-wins.** Defining the same endpoint twice is almost always a mistake; the builder surfaces it at the cursor.
- **The native escape hatch is `.native`.** The underlying `H3DuxApp` is reachable as `app.native` (renamed from `.app` for clarity); routes added through it accumulate into the dux contract via `.register`, so the escape hatch doesn't silently desync the client's type.

---

## 10. Typed middleware bindings

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
- **`handler` retains full h3 behavior.** It receives the staged values, inherited plus newly published bindings, and `next`. Omitting it means "publish bindings, then continue."
- **`.use((event, next) => …)` is the smallest inline form.** Inside `.use(...)` — which h3-dux controls — a bare callback needs no `defineMiddleware` wrap; its `event` is typed against the chain's accumulated bindings (so `event.bindings` reads what earlier middleware published) and it publishes nothing. `defineMiddleware(fn)` is for middleware defined *outside* `.use` and then passed in; the two share one runtime path, so the wrap is never required just to satisfy `.use`. (This mirrors the route verbs' bare-handler shorthand, [§2](#2-server--client-symmetry).)
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

### Writing utilities for the event

A utility that works with a handler's `event` annotates **`H3DuxEvent`** — the route-agnostic handler event, and the dux counterpart of reaching for h3's `H3Event`. No interface to hand-roll:

```ts
import type { H3DuxEvent } from '@mszr/h3-dux'

// Accepts the event from ANY route — standalone, router, or file route.
function requireKey(e: H3DuxEvent): void {
  if (e.req.headers.get('x-key') !== KEY)
    throw e.error(401, { error: 'unauthorized' })
}
```

`H3DuxEvent` is the public base every per-route handler event is assignable to: the full `H3Event` surface plus the dux additions at their loosest honest types — `event.error(status, data)` (route-agnostic here; narrowed to the *declared* statuses inside a handler, where the contract is known), the request aliases, and `event.bindings`. When a util depends on a middleware capability, parameterize it — `function requireOwner(e: H3DuxEvent<{ user: User }>)` — and `e.bindings.user` is typed. This is the principle-9 payoff for composability: plugging your own helpers into h3-dux costs an import, not a hand-written interface.
