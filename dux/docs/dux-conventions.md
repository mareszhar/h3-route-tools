# h3-dux — conventions

The cross-cutting law: the words, the names, and the few rules that make every h3-dux surface feel like one
library. [dux-vision.md](./dux-vision.md) principles 4 and 5 are the *why* — self-documenting, predictable, learn
one and know the rest; this doc is the *what*.

Every name we add answers three questions: does it say what the thing **is** (not what an ancestor called it), is
it **technically accurate**, and is it used **consistently** everywhere the concept appears? Where upstream or h3
core already has a precise word, we keep it — renaming for sport is its own kind of boilerplate.

- [0. House style](#0-house-style)
- [1. Vocabulary](#1-vocabulary)
- [2. The fetchdts alignment](#2-the-fetchdts-alignment)
- [3. Values vs types](#3-values-vs-types)
- [4. The validated-data model](#4-the-validated-data-model)
- [5. Server ↔ client symmetry](#5-server--client-symmetry)
- [6. Response typing](#6-response-typing)
- [7. Validation errors](#7-validation-errors)
- [8. The naming map](#8-the-naming-map)

---

## 0. House style

The style for every h3-dux doc.

- **Precise, not padded.** One concept, one term; synonyms signal different things. Use the technical word when
  the domain calls for it. Write to lower the reader's effort, not to sound thorough.
- **Decisions, not deliberations.** State the current answer, not the path to it. Imperative or declarative ("use
  X", "X is Y"), never "you might consider X".
- **Rationale earns its place.** Explain a choice when the reason is non-obvious or guards a known trap —
  otherwise let the rule stand clean. The two failure modes are equal: commentary that buries the rule, and
  terseness that makes it feel arbitrary.
- **No hedging.** Drop *generally*, *usually*, *try to* unless a real exception needs surfacing — then state it.
- **DRY.** Link to the canonical place instead of restating it. A fact lives in one doc; the others reference it.

---

## 1. Vocabulary

These words carry exactly these meanings across the server, client, and Nitro surfaces.

| Term | Means |
|---|---|
| **route** | a path pattern (`/fruits/:id`); the unit you author and address |
| **method** | the HTTP verb on a route (`get`, `post`, …); a route has one contract per method |
| **endpoint** | a route + method pair — the addressable unit the client targets |
| **contract** | a method's full type: its `validate` block + handler return; what accumulates into `typeof app` |
| **validate block** | the `validate: { params, query, body, headers, response, eager? }` object on a method |
| **handler** | the function that runs for a method; receives the typed `event`, returns the response |
| **middleware** | plain h3 middleware on a route; how auth and cross-cutting concerns attach (never a kit concept) |
| **eager / manual** | the two validation modes — auto-run before the handler, or on-demand via `event.valid()` ([§4](#4-the-validated-data-model)) |
| **EventStream** | a response branded by `sse(schema)` — a typed `text/event-stream`, consumed as `AsyncGenerator<T>` |

`params`, `query`, `body`, `headers`, `response` keep their h3 / fetchdts meanings ([§2](#2-the-fetchdts-alignment))
and appear identically in the `validate` block, on `event.context`, and in the client call options.

---

## 2. The fetchdts alignment

The typed client speaks [fetchdts](https://github.com/unjs/fetchdts) — the type-level vocabulary a Nuxt-core
contributor is standardizing. We stay inside it so the client realigns cheaply if fetchdts ships more.

- Per-endpoint metadata keys are **`query`, `headers`, `body`, `response`, `responseHeaders`** — note it is
  **`response`, not `output`**.
- Paths are **string literals**, and dynamic segments are **template-literal** paths (`/fruits/${string}`). That
  is what lets interpolation (`api.get(\`/fruits/${id}\`)`, [delta 3](./dux-spec.md)) typecheck on the client.
- The client surface is **verb + literal path** (`api.get('/fruits/:id', …)`), not an Eden-style proxy chain.

---

## 3. Values vs types

- **Values are unprefixed:** `createServer`, `createClient`, `defineRoute`, `sse`. The package specifier already
  namespaces them; a userland clash is one `import { sse as sseStream }` away.
- **Types stay close to upstream and h3.** We re-export h3-route-tools' type names unchanged (`TypedFetch`,
  `Endpoint`, `RouteHandler`, …) — renaming them would only make diffing upstream harder. New types we introduce
  read plainly and domain-scoped (`EventStream<T>`); no vanity brand prefix.

The rule of thumb: **a re-exported name keeps its upstream spelling; a name we coin is chosen for precision.**

---

## 4. The validated-data model

How a handler reads validated request data — and the one place h3-dux deliberately improves on upstream's
`event.validated` bag. Two accessors, each with one honest job:

- **`event.context.<scope>`** — the neutral, always-typed read, aligned with [h3 core PR #1237](https://github.com/h3js/h3/pull/1237).
  In **eager** mode it holds the *validated* value; in **manual** mode `params`/`query` are typed-parsed and
  `body` is deferred until you ask for it. This is the default read.
- **`event.valid('<scope>')`** — the deliberate, idempotent validator. It runs validation for that scope *at the
  call site*, returns the typed value, and throws → `422` on failure (Hono's `c.req.valid()`, but it also runs,
  not just reads). In **manual** mode it is how you opt in — your order, your conditions. In **eager** mode it
  simply returns the already-validated, cached value, so the same call works in both modes.

We **drop `event.validated`** from the documented surface. Under `eager: false` a `.validated.body` property is a
lie — nothing was validated — whereas `event.valid('body')` reads as the deliberate action it is, and
`event.context.*` covers the neutral read. (`event.validated` may survive internally only as a diffing aid.)

`eager: false` lives **inside the `validate` block**, next to the schemas it governs. Full contract and the
pipeline order: [dux-spec.md §5](./dux-spec.md).

---

## 5. Server ↔ client symmetry

The server verb you author and the client verb you call are the **same word**. This is principle 5 made literal:

```ts
app.get('/fruits/:id', { handler })        // authoring          (delta 1)
api.get('/fruits/:id', { params: { id } }) // calling            (delta 2)
```

`createServer` and `createClient` are named as counterparts for the same reason — one integrated system, read
from both ends. The bare upstream forms (`.route({ … })`, `api(path, { method })`) stay valid; the verb forms are
additive sugar.

---

## 6. Response typing

Response typing is **hybrid**, and the default is zero-ceremony:

- **Inferred by default.** With no `validate.response`, the handler's return *is* the client's type. This is the
  Hono/Elysia parity that kills the hand-written `request<Receipt>(…)` assertion.
- **Validated on opt-in.** Declaring `validate.response` does two things: it type-checks the handler's return
  against the schema (it can't lie), and it runtime-validates the response before sending (→ `500` on a breach).
- **Streamed via `sse()`.** `sse(schema)` is the streaming form of `validate.response`: it brands the endpoint so
  the client returns `AsyncGenerator<T>` instead of a JSON body ([dux-spec.md §4](./dux-spec.md)).

Client response types are the **wire shape**: a `v.date()` / `z.date()` field arrives as `string`, because that
is what JSON gives you. (Inherited from upstream's `Serialize`.)

---

## 7. Validation errors

We keep upstream's model verbatim — it is already excellent. One hook, `onValidationError`, receives
`{ source, issues, event }` and runs at three cascading scopes (**method → route → app**, narrower wins). Return
`ErrorDetails` to shape the response, or nothing for the default (`400` request / `500` response, carrying
`issues`). A response failure always stays `500` — it is a server-side contract breach.

h3-dux adds no new error concept here; it inherits the cascade and documents it. The reference envelope (e.g.
`422` for request validation) is a userland `onValidationError`, not a kit default.

---

## 8. The naming map

Every name h3-dux coins or renames, with the upstream / standard term it maps to and why. New names are settled
here once; the spec references this table rather than re-justifying each.

| h3-dux | Upstream / standard | Why |
|---|---|---|
| `createServer()` | `new H3Typed()` | counterpart of `createClient`; factory reads better than `new`; self-documents "this is the server" |
| `createClient<App>()` | `createTypedFetch<App>()` | counterpart of `createServer`; "client" says what it is at the call site |
| `defineRoute` | `defineRoute` (kept) | already precise and converging with [h3 core](https://github.com/h3js/h3/issues/1088) |
| `app.get(path, opts)` | `.route({ route, get })` | verb authoring; mirrors the client and the HTTP method |
| `api.get(path, opts)` | `api(path, { method: 'get' })` | verb sugar; symmetric with the server |
| `sse(schema)` | — (new) | brands a `validate.response` as a typed `EventStream`; fetchdts `response` vocabulary |
| `validate: { eager: false }` | — (new) | switches the validation pipeline to manual/on-demand |
| `event.valid('scope')` | — (new) | deliberate, idempotent validator; Hono `c.req.valid()` parity ([§4](#4-the-validated-data-model)) |
| `event.context.<scope>` | `event.validated.<scope>` | neutral typed read; aligns with [h3 core PR #1237](https://github.com/h3js/h3/pull/1237) |

Everything not in this table is re-exported from h3-route-tools **unchanged** — that is the default, and it is
what keeps the fork diffable ([dux-vision.md §7](./dux-vision.md#7-how-h3-dux-stays-alive)).
