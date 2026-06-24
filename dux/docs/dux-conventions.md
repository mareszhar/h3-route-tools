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
- [13. Typed event context](#13-typed-event-context)
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
| **middleware** | plain h3 middleware on a route; how auth and cross-cutting concerns attach (never a kit concept) |
| **eager / manual** | the two validation modes — auto-run before the handler, or on-demand via `event.valid()` ([§4](#4-the-validated-data-model)) |
| **EventStream** | a response branded by `sse(schema)` — a typed `text/event-stream`, consumed as `AsyncGenerator<T>` |
| **endpoint contract / kernel** | the normalized, schema-free projection of an endpoint that every plane reads: `{ request, responses, success }` ([§8](#8-the-contract-kernel)) |
| **result** | what a default client call resolves to: `{ data, error }` — `data` on 2xx, a typed `error` otherwise ([§9](#9-the-honest-client)) |
| **DuxError** | the client-side failure: `DuxHTTPError` (a typed non-2xx response) or `DuxTransportError` (the request never completed) ([§10](#10-typed-errors--results)) |
| **response kind** | how a response body crosses the wire — `json \| text \| empty \| sse \| binary` ([§11](#11-response-kinds)) |
| **router** | a delta-carrying, route-free group built with `createRouter`/`defineRoutes`, mounted into a server ([§12](#12-composition--scope)) |
| **context contribution** | the typed slice a `defineMiddleware` publishes onto `event.context` for downstream handlers ([§13](#13-typed-event-context)) |

`params`, `query`, `body`, `headers`, `response` keep their h3 / fetchdts meanings ([§2](#2-the-fetchdts-alignment)) and appear identically in the `validate` block, on `event.context`, and in the client call options.

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

How a handler reads validated request data — and the one place h3-dux deliberately improves on upstream's `event.validated` bag. Two accessors, each with one honest job:

- **`event.context.<scope>`** — the neutral, always-typed read, aligned with [h3 core PR #1237](https://github.com/h3js/h3/pull/1237). In **eager** mode it holds the *validated* value; in **manual** mode `params`/`query` are typed-parsed and `body` is deferred until you ask for it. This is the default read.
- **`event.valid('<scope>')`** — the deliberate, idempotent validator. It runs validation for that scope *at the call site*, returns the typed value, and throws → `422` on failure (Hono's `c.req.valid()`, but it also runs, not just reads). In **manual** mode it is how you opt in — your order, your conditions. In **eager** mode it simply returns the already-validated, cached value, so the same call works in both modes.

A request-validation failure is **`422` regardless of mode** ([§7](#7-validation-errors)): the status a client sees must not depend on a server-internal mode choice (principle 5 — no surprises between siblings).

We **drop `event.validated`** from the surface — from the *types*, not just the docs. Under `eager: false` a `.validated.body` property is a lie (nothing was validated); `event.valid('body')` reads as the deliberate action it is, and `event.context.*` covers the neutral read. (Upstream's `event.validated` stays available underneath for diffing, but the dux `MethodEvent` does not expose it.)

`eager: false` lives **inside the `validate` block**, next to the schemas it governs. So does `params`: on the dux verb surface `validate.params` is where you declare the param schema, so the whole request contract reads from one block — even though params are *route-level* underneath (one schema per path, shared across methods), which is where they live for multi-method routes and grouped routers ([§12](#12-composition--scope)). Full contract and the pipeline order: [dux-spec.md §5](./dux-spec.md).

---

## 5. Server ↔ client symmetry

The server verb you author and the client verb you call are the **same word**. This is principle 5 made literal:

```ts
app.get('/fruits/:id', { handler })        // authoring          (delta 1)
api.get('/fruits/:id', { params: { id } }) // calling            (delta 2)
```

`createServer` and `createClient` are named as counterparts for the same reason — one integrated system, read from both ends. The bare upstream forms (`.route({ … })`, `api(path, { method })`) stay valid; the verb forms are additive sugar.

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
| `await api.get(path, opts).raw()` | `TypedResponse<Data>` | headers, status, redirects — the web-standard escape hatch |
| `for await (… of api.get(path, opts))` | `AsyncGenerator<T>` | an `sse()` endpoint, unchanged |

`.orThrow()` keeps the one-liner for cases where bubbling is correct — but you have to *name* the choice to discard the error, which reads as the decision it is (Go's `_`, made legible). `.raw()` never throws on a non-2xx; it hands you the standard `Response` to inspect.

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

The common case needs nothing: a handler that returns an object is `json`, inferred. Kinds are opt-in for the rest — a `204` no-content `delete`, a `text/plain` health string, a file download — and they keep the client from guessing `.json()` on a body that has none. `sse()` is simply the `sse` kind with a brand; this generalizes it rather than treating streaming as a special case. Native `Response` returns from a handler pass through as-is and are typed as such.

---

## 12. Composition & scope

A server is authored by chaining (`createServer().get(…).post(…)`), and the accumulated `typeof app` is the source of truth. That doesn't scale to many files — so domains compose through **routers**:

```ts
// fruits.routes.ts — a domain module, no server, deltas intact
export const fruits = createRouter()
  .get('/:id', { validate: { response: FruitSchema }, handler: e => orchard.get(e.context.params.id) })
  .post('/', { status: 201, validate: { body: NewFruitSchema }, handler: e => orchard.create(e.context.body) })

// app.ts — aggregate and prefix-mount
export const app = createServer()
  .mount('/fruits', fruits) // routes become /fruits/:id, /fruits; contracts merge
  .mount(checkout)          // no prefix; merge as-is
export type App = typeof app
```

The rules that make composition trustworthy:

- **Routers carry the deltas.** A `createRouter`/`defineRoutes` group is *delta-aware* — verb authoring, validation modes, `sse()`, response/param inference, typed errors, typed context — so splitting a domain into its own file never drops you back to upstream ergonomics. (Composing via upstream's `defineRoute`/`mountRoutes` still works and still accumulates; the router is the form that keeps the deltas.)
- **`mount(prefix?, sub)` merges kernels.** Routes are prefixed, contracts merged via the same mechanism the chain uses; the client sees one flat map. This is Hono's `app.route(prefix, sub)` / Elysia's `.group` parity, the dux way.
- **Accumulation requires chaining.** `app.get(); app.get();` as separate statements loses the accumulated type — an industry-wide constraint (Hono and Elysia share it). The *escape* from a giant chain is exactly the router/`mount` split above; we say so rather than letting it surprise.
- **Duplicate route+method is a diagnostic, not silent first-wins.** Defining the same endpoint twice is almost always a mistake; the builder surfaces it at the cursor.
- **The native escape hatch is `.native`.** The underlying `H3Typed` is reachable as `app.native` (renamed from `.app` for clarity); routes added through it accumulate into the dux contract via `.register`, so the escape hatch doesn't silently desync the client's type.

---

## 13. Typed event context

`middleware: [...]` is plain h3 — auth and cross-cutting concerns attach there, and that stays true (vision §6). What Generation 1 *couldn't* do is let a middleware tell the type system what it adds to `event.context`: if `requireKey` sets `event.context.user`, a downstream handler had to cast. Typed context closes that — as a **typing primitive, decoupled from auth**:

```ts
const withUser = defineMiddleware((e) => {
  const user = authenticate(e) // throws 401 on failure — plain h3
  return { user } //              the typed context contribution
})

app.use(withUser).get('/me', { handler: e => e.context.user }) // e.context.user: User, no cast
```

The model, kept deliberately small:

- **A `defineMiddleware` publishes a contribution** — the object it returns is merged, typed, into `event.context` for everything registered after it. Returning nothing keeps it a pure side-effecting middleware (logging, headers), exactly as before.
- **Scope follows registration.** `app.use(…)` contributes to every route after it; a router's `.use(…)` contributes within that router; a per-route `middleware` contributes to that route. Contributions merge in order, so `event.context` is precisely "what the middleware on this path have published" — route-specific intellisense, not a global bag.
- **Auth is still not a concept.** `defineMiddleware` knows nothing about authentication; it is how *any* middleware — a DB handle, a request id, a resolved tenant, a user — becomes typed downstream. This is Hono's `Variables` / Elysia's `derive`·`decorate` parity, named for what it is.
- **Plain h3 middleware still works untyped.** You opt into typing by reaching for `defineMiddleware`; an existing `(e, next) => …` keeps working and contributes nothing to the type (principle 9).

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
| `validate: { eager: false }` | — (new) | switches the validation pipeline to manual/on-demand |
| `event.valid('scope')` | — (new) | deliberate, idempotent validator; Hono `c.req.valid()` parity ([§4](#4-the-validated-data-model)) |
| `event.context.<scope>` | `event.validated.<scope>` | neutral typed read; aligns with [h3 core PR #1237](https://github.com/h3js/h3/pull/1237) |
| `{ data, error }` | — (new) | the honest default result; `data` on 2xx, typed `error` otherwise ([§9](#9-the-honest-client)) |
| `.orThrow()` | ofetch `$fetch` (throws) | legible opt-out: bubble the error instead of returning it |
| `.raw()` | ofetch `.raw` | the native `TypedResponse` escape hatch; never throws on non-2xx |
| `errors: { 409: … }` | upstream `errors` (kept, widened) | per-status failure schemas in the contract; feeds client + runtime + OpenAPI ([§10](#10-typed-errors--results)) |
| `event.error(status, data)` | `HTTPError` / `createError` | typed thrower checked against the declared `errors` schema |
| `createRouter()` / `defineRoutes()` | `defineRoute` + `register` | delta-carrying, route-free composition unit ([§12](#12-composition--scope)) |
| `app.mount(prefix?, sub)` | `H3.mount` / `app.register` | prefix-mount a router, merging contracts; Hono `.route` / Elysia `.group` parity |
| `app.native` | `DuxServer.app` (renamed) | the underlying `H3Typed` escape hatch; clearer than `.app` |
| `defineMiddleware(fn)` | — (new) | middleware that publishes a typed context contribution ([§13](#13-typed-event-context)) |

Everything not in this table is re-exported from h3-route-tools **unchanged** — that is the default, and it is what keeps the fork diffable ([dux-vision.md §7](./dux-vision.md#7-how-h3-dux-stays-alive)).
