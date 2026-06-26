# h3-dux — language

The words: vocabulary, naming rules, and doc style that make every h3-dux surface read like one library. [dux-vision.md](./dux-vision.md) principles 4 and 5 are the *why* — self-documenting, predictable, learn one and know the rest; this doc is the *what*. The cross-cutting behavioral patterns that vocabulary describes — the validated-data model, the kernel, the honest client, composition, middleware bindings — live in [dux-patterns.md](./dux-patterns.md).

Every name we add answers three questions: does it say what the thing **is** (not what an ancestor called it), is it **technically accurate**, and is it used **consistently** everywhere the concept appears? Where upstream or h3 core already has a precise word, we keep it — renaming for sport is its own kind of boilerplate.

- [0. House style](#0-house-style)
- [1. Vocabulary](#1-vocabulary)
- [2. The fetchdts alignment](#2-the-fetchdts-alignment)
- [3. Values vs types](#3-values-vs-types)
- [4. The naming map](#4-the-naming-map)

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

Now `Fruit` reads as `Fruit` at the cursor instead of `{ id: string; emoji: string; … }`. The contract kernel ([dux-patterns.md §5](./dux-patterns.md#5-the-contract-kernel)) does this on the *kit* side (it prettifies at the public boundary); this is its userland complement, and the demos and docs model it.

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
| **eager / manual** | the two validation modes — auto-run before the handler, or on-demand via `event.valid()` ([dux-patterns.md §1](./dux-patterns.md#1-the-validated-data-model)) |
| **EventStream** | a response branded by `sse(schema)` — a typed `text/event-stream`, consumed as `AsyncGenerator<T>` |
| **endpoint contract / kernel** | the normalized, schema-free projection of an endpoint that every plane reads: `{ request, responses, success }` ([dux-patterns.md §5](./dux-patterns.md#5-the-contract-kernel)) |
| **result** | what a default client call resolves to: `{ data, error }` — `data` on 2xx, a typed `error` otherwise ([dux-patterns.md §6](./dux-patterns.md#6-the-honest-client)) |
| **H3DuxError** | the client-side failure: `H3DuxHTTPError` (a typed non-2xx response) or `H3DuxTransportError` (the request never completed) ([dux-patterns.md §7](./dux-patterns.md#7-typed-errors--results)) |
| **response kind** | how a response body crosses the wire — `json \| text \| empty \| sse \| binary` ([dux-patterns.md §8](./dux-patterns.md#8-response-kinds)) |
| **router** | a delta-carrying route group built with `createRouter`, optionally owning a literal prefix, then mounted into a server ([dux-patterns.md §9](./dux-patterns.md#9-composition--scope)) |
| **staged values** | middleware-private preparation returned by `staged`; visible only to that middleware's `bindings` and `handler` callbacks ([dux-patterns.md §10](./dux-patterns.md#10-typed-middleware-bindings)) |
| **bindings** | request-scoped values a typed middleware publishes to downstream middleware and handlers as `event.bindings` ([dux-patterns.md §10](./dux-patterns.md#10-typed-middleware-bindings)) |
| **requirements** | middleware or parent-path capabilities that a middleware, router, or endpoint consumes without registering them again ([dux-patterns.md §9](./dux-patterns.md#9-composition--scope), [dux-patterns.md §10](./dux-patterns.md#10-typed-middleware-bindings)) |
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

## 4. The naming map

Every name h3-dux coins or renames, with the upstream / standard term it maps to and why. New names are settled here once; the spec references this table rather than re-justifying each.

| h3-dux | Upstream / standard | Why |
| --- | --- | --- |
| `createServer()` | `new H3Typed()` | counterpart of `createClient`; factory reads better than `new`; self-documents "this is the server" |
| `createClient<App>()` | `createTypedFetch<App>()` | counterpart of `createServer`; "client" says what it is at the call site |
| `defineRoute` | `defineRoute` (kept) | already precise and converging with [h3 core](https://github.com/h3js/h3/issues/1088) |
| `app.get(path, opts)` | `.route({ route, get })` | verb authoring; mirrors the client and the HTTP method |
| `api.get(path, opts)` | `api(path, { method: 'get' })` | verb sugar; symmetric with the server |
| `sse(schema)` | — (new) | brands a `validate.response` as a typed `EventStream`; the `sse` response kind ([dux-patterns.md §8](./dux-patterns.md#8-response-kinds)) |
| `text()` / `binary()` | — (new) | explicit kind overrides for an ambiguous response schema; ordinary strings/Blobs infer automatically ([dux-patterns.md §8](./dux-patterns.md#8-response-kinds)) |
| `typedResponse(data, init?)` | `new Response(body, init)` | constructs a real native `Response` while carrying its inferred body contract end-to-end |
| `validate: { eager: false }` | — (new) | switches the validation pipeline to manual/on-demand |
| `event.valid('scope')` | — (new) | deliberate, idempotent validator; Hono `c.req.valid()` parity ([dux-patterns.md §1](./dux-patterns.md#1-the-validated-data-model)) |
| `event.params/query/body` | `event.context.<scope>` | root getters over the same canonical request values; direct types stay honest across eager/manual modes ([dux-patterns.md §1](./dux-patterns.md#1-the-validated-data-model)) |
| `{ data, error }` | — (new) | the honest default result; `data` on 2xx, typed `error` otherwise ([dux-patterns.md §6](./dux-patterns.md#6-the-honest-client)) |
| `.orThrow()` | ofetch `$fetch` (throws) | legible opt-out: bubble the error instead of returning it |
| `.raw()` | ofetch `.raw` | native response metadata plus kind-aware `.parse()`; never throws on non-2xx |
| `errors: { 409: … }` | upstream `errors` (kept, widened) | per-status failure schemas in the contract; feeds client + runtime + OpenAPI ([dux-patterns.md §7](./dux-patterns.md#7-typed-errors--results)) |
| `event.error(status, data)` | `HTTPError` / `createError` | typed thrower checked against the declared `errors` schema |
| `createRouter(prefix?, options?)` | `defineRoute` + `register` | delta-carrying composition unit; an optional literal prefix belongs to the domain and participates in param inference ([dux-patterns.md §9](./dux-patterns.md#9-composition--scope)) |
| `app.mount(router)` / `app.mount(outerPrefix, router)` | `H3.mount` / `app.register` | merge a router as declared, optionally adding an outer prefix |
| `app.native` | `H3DuxServer.app` (renamed) | the underlying `H3Typed` escape hatch; clearer than `.app` |
| `defineMiddleware(fn \| options)` | h3 `Middleware` | ordinary middleware plus optional `staged` preparation, downstream `bindings`, and checked `requires` ([dux-patterns.md §10](./dux-patterns.md#10-typed-middleware-bindings)) |
| `event.bindings` | `event.context.bindings` | request-scoped capabilities published by typed middleware |
| `event.staged` | `event.context.staged` | temporary values private to one middleware's `bindings`/`handler` lifecycle |
| `.requires(provider)` / `requires: […]` | — (new) | consume already-registered middleware capabilities without executing the middleware again |
| `defineFileRoute(def)` | Nitro `defineHandler` / upstream `defineRouteHandler` | route-free dux handler whose path and optional method come from the Nitro filename; carries the kernel and phase-8 event model ([spec §13](./dux-spec.md#13-nitro-deltas-via-codegen)) |
| `createFileRouteFactory()` | — (new) | derive reusable file-route definers with typed middleware providers and requirements |
| `factory.compose(feature)` | router `.mount()` | satisfy a feature factory's external capabilities and return a callable file-route factory; checks the same laws as `.mount` (requirements present and assignable, registered providers don't collide) and doesn't re-run required middleware |
| `#h3-dux/routes` | Nitro generated route types | generated, type-only kernel route map consumed by `createClient<Routes>()` |

Everything not in this table is re-exported from h3-route-tools **unchanged** — that is the default, and it is what keeps the fork diffable ([dux-vision.md §7](./dux-vision.md#7-how-h3-dux-stays-alive)).

**The `H3Dux` prefix.** Every shipped type/class that needs a project-specific name — because it has no upstream counterpart and isn't a generic verb (`H3DuxError`, `H3DuxHTTPError`, `H3DuxTransportError`, `H3DuxServer`, `H3DuxRouter`, `H3DuxCall`, …) — is named `H3Dux*`, never bare `Dux*`. The maintainer forks several libraries this way (`idb-dux`, `h3-dux`, …); a bare `Dux*` name is ambiguous the moment two of those forks are imported into the same project, while `H3Dux*` says which one at the name itself. This applies to the shipped surface only — `dux` stays the plain, simple word for this repo, this workspace, and this doc set (`dux/`, "the dux branch", *dux-vision*, *dux-spec*, …).
