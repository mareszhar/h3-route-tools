# proposal expert O

I've now read the vision/conventions/spec docs, the full `dux/h3-dux` implementation (client, server, internal route-types, serialize, sse), the upstream `h3-route-tools` machinery it wraps (`typed-fetch.ts`, `route-handler.ts`, `routes.ts`), the demos (standalone + Nitro), the Selenita DX test, and the [Selenita README](https://raw.githubusercontent.com/mareszhar/selenita/refs/heads/main/README.md). Here's my assessment.

A note on format: I've kept everything in text/markdown tables (no diagrams) since you may hand this to someone who only sees this message, and I reference files as clickable `path:line` so the cause of each claim is verifiable.

---

## Orientation: what h3-dux is and where it sits

For the expert reading cold: **h3-dux** (`@mszr/h3-dux`) is a DX-first *fork* of [`h3-route-tools`](https://github.com/sandros94/h3-route-tools) — an end-to-end-typed routing layer for h3 v2 / Nitro v3. The upstream library already does the hard part: an accumulating typed route builder whose `typeof app` is the single source of truth, Standard Schema validation, a [fetchdts](https://github.com/unjs/fetchdts)-style typed client, Nitro file-based codegen, and OpenAPI. h3-dux re-exports all of that unchanged and adds five "deltas" on top — per-verb server authoring (`app.get`), per-verb client sugar (`api.get`), path interpolation, typed SSE, and eager/manual validation modes. The design canon ([dux-vision.md](dux/docs/dux-vision.md) §3) ranks *delightful → boilerplate-is-harm → errors-at-the-cursor* as its top three principles.

The deltas live almost entirely in [client.ts](dux/h3-dux/src/client.ts), [server.ts](dux/h3-dux/src/server.ts), and [internal/route-types.ts](dux/h3-dux/src/internal/route-types.ts). Everything below is grounded there.

---

## Q1 — Cleaner inference and actionable diagnostics

**Verdict: fully fixable inside h3-dux's own client types. No upstream rewrite, no reimplementing `SerializeObject`-style machinery. The bad message has three distinct, independently-fixable causes — and one of them lets you delete a whole construct rather than patch it.**

### Why the message is a mouthful — the three causes

**Cause 1: static routes match *both* client overloads, doubling the error.** `VerbFetch` has two call signatures ([client.ts:116-125](dux/h3-dux/src/client.ts:116)): a literal-pattern overload and an interpolation-template overload. `PathTemplate<P>` returns `P` unchanged when the route has no `:param` ([client.ts:63](dux/h3-dux/src/client.ts:63)), so `/fruits` is simultaneously a `VerbPatterns` member *and* a `VerbTemplates` member, and `NotPattern<'/fruits'>` lets it through the second overload too ([client.ts:103](dux/h3-dux/src/client.ts:103)). TypeScript therefore tries both, both fail identically, and you get "Overload 1 of 2 … Overload 2 of 2 …" — the entire message printed twice.
*Fix:* generate the interpolation overload **only** from routes that actually contain a `:param` (filter `VerbTemplates` to patterns where `PathTemplate<P> !== P`). Then `/fruits` matches overload 1 only, and the message halves immediately.

**Cause 2: the `O & NoExcess<O, …>` construct anchors the expected type to a giant intersection.** The options argument is typed `O & NoExcess<O, VerbOptions<E, true>>` ([client.ts:98-100](dux/h3-dux/src/client.ts:98)). When a body field is missing, the "expected type" TypeScript prints is this whole `Prettify<{params?} & {body:{…}} & QueryHeaderOption<…>> & NoExcess<…>` intersection — that's the front-loaded soup, and the readable `body: { … }` shape is buried at the very end.

**Cause 3: valibot schema internals leak through an *unresolved* generic.** `QueryHeaderOption<E>` is declared as an `interface` ([client.ts:37](dux/h3-dux/src/client.ts:37)), so TypeScript prints it as `QueryHeaderOption<…the literal E…>` without resolving its members — and `E` here is the full `DuxEndpoint<{ body: Omit<ObjectSchema<…>>, response: ObjectSchema<…> }, …>`. That's why `SchemaWithPipe`, `Omit<ObjectSchema<…>>`, etc. appear: they're the *type arguments* of a deferred generic, not the body shape itself.

### The sharpest fix: the verb client doesn't need `O` at all

Here's the insight I'd add beyond "pass `VerbOptions` as the contextual type." The reason upstream captures `O` generically is to recover the method from `O["method"]` so the response can narrow — see the comment at [typed-fetch.ts:57-59](src/typed-fetch.ts:57) ("The leading `O &` is required: it anchors method inference"). **But h3-dux's verb methods fix the method by name** — `api.post` *is* the method. The return type is `VerbReturn<MatchEndpoint<R, M, Route>>`, which depends only on `R`, `M`, and `Route` — never on `O`. So the entire `O`-capture-plus-`NoExcess` apparatus is cargo inherited from a constraint that doesn't apply to verbs.

Drop `O`. Type the options parameter as the concrete `VerbOptions<E>` directly:

```TS
// today (client.ts:117-120): generic O capture + NoExcess intersection
<const Route extends …, const O extends VerbOptions<…>>(
  route: Route, ...args: VerbArgs<…, true, O>
): VerbReturn<…>

// proposed: no O — the verb already fixes the method
<const Route extends …>(
  route: Route, ...args: VerbArgs<MatchEndpoint<R, M, Route>, true>
): VerbReturn<MatchEndpoint<R, M, Route>>
```

This single change:
- **Restores native excess-property checking.** `NoExcess` only exists because a captured generic `O` *defeats* TS's built-in fresh-object-literal check (the literal is assignable to itself). With a concrete parameter type, `api.post('/fruits', { body, bogus })` flags `bogus` natively — and you delete `NoExcess` entirely.
- **Removes the intersection** from the printed expected type, so a missing field reports against a plain object type.

### Plus one flattening step

Add a small mapped "client view" that resolves the endpoint into a flat `{ params; query; body; headers; response }` of plain shapes before building options (a `{ [K in keyof E]: E[K] }`-style resolve). That collapses `DuxEndpoint<ObjectSchema<…>>` into resolved members so the leaked valibot guts (cause 3) disappear from the display. h3-dux already vendors `Serialize` for exactly this "show the wire shape, not the schema" reason ([internal/serialize.ts](dux/h3-dux/src/internal/serialize.ts)); this is the same move on the input side.

**Expected end state:** deleting `stockKg: 3` yields roughly

> `Property 'stockKg' is missing in type '{ name: string; emoji: string; pricePerKg: number; }' but required in type '{ name: string; emoji: string; pricePerKg: number; stockKg: number; }'.` — landing on `body`.

### Make the diagnostic a *tested contract*, not an accident

The current DX test only asserts an error *exists* — `expect(errors).toHaveError(/not assignable/)` ([client.dx.test.ts:31](dux/h3-dux/src/client.dx.test.ts:31)). That's why the bar slipped: a green suite never proved the message was good. Selenita supports the assertions to lock real quality — `toContainCompletions`, `completionItem(name).toHaveType(...)`, `forModes` (source vs built `.d.ts`), `toHaveCompletionParity`. I'd treat "the diagnostic is singular, names the offending field, says missing/required, and lands on `body`" as a first-class contract in [dux-spec.md](dux/docs/dux-spec.md), with assertions for: exactly one diagnostic (not two overloads), mentions `stockKg`, mentions missing/required, and hover snapshots stay readable across `forModes`. **No one in this space tests diagnostic quality — making it a contract is itself differentiating and directly serves principle 3.**

**Feasibility: high, client-types-only, low-risk.** You do *not* need to fork upstream's serialization/inference types to fix this. The only "custom reconstruction" required is a small flattening mapped type. (And avoid branded custom-error-string types — they tend to *worsen* completions and produce stranger messages.)

---

## Q2 — Response/error consumption ergonomics

**Verdict: the double-`await` should go. Make the client data-first by default, keep the native `Response` on a `.raw` namespace, and — the part I'd push further than the prior agent — make typed errors real by carrying per-status schemas in the contract. The capability is *latent in upstream already*.**

### The double-await is inherited, and worth breaking from

`await (await api.get('/health')).json()` exists because the verb returns `Promise<TypedResponse<…>>` ([client.ts:60](dux/h3-dux/src/client.ts:60)) and `.json()` comes from upstream's `TypedResponse` ([typed-fetch.ts:6](src/typed-fetch.ts:6)). This is *exactly* Hono's `hc` ergonomics (`await (await client.x.$get()).json()`) — i.e. h3-dux is currently at Hono's level here, and behind Nuxt's `$fetch`/ofetch and Elysia Treaty, both of which hand you data directly.

The "one hard contract" ([dux-vision.md](dux/docs/dux-vision.md) §1) is *behavioral* compatibility with h3/Nitro, not API compatibility with the raw `Response`. So a data-first high-level client is fully in-bounds — the standard `Response` stays reachable underneath.

### Recommended surface (three layers, one default)

| Call | Returns | Use |
|---|---|---|
| `await api.get('/fruits/:id', { params })` | `Fruit` (data) | the 90% happy path; throws `DuxError` on non-2xx |
| `await api.raw.get(...)` | `TypedResponse<Fruit>` | headers, status, streaming, redirects |
| `await api.safe.get(...)` | `{ data, error, response }` | branch on typed errors without try/catch |

`DuxError extends Error` carries `{ status, data, response }`. This kills the double-await, fixes a latent **type-safety hole** (today `.json()` is typed as the *success* body even on a 4xx — so an error envelope can masquerade as a `Fruit`), and preserves the web-standard escape hatch. I agree with the prior agent on data-first + `.raw` + throw, and on *not* using a per-call `{ raw: true }` flag (it adds another conditional generic and hurts IntelliSense — a namespace is clearer and more discoverable).

### Where I'd go further: typed errors are closer than they look

The prior agent filed typed errors as "later, opt-in `api.try`." I'd design them now, because **upstream already models per-status response schemas and h3-dux is currently throwing that information away:**

- Upstream's response slot is `ResponseValidation = SchemaWithJSON | Record<StatusCodeKey, SchemaWithJSON>` ([route-handler.ts:42](src/route-handler.ts:42)) — i.e. `{ 200: Fruit, 404: NotFound, 422: Issues }` is already expressible and runtime-validated.
- There's an `errors` option and `ErrorResponsesOption` for auto 400/415/500 ([route-handler.ts:253](src/route-handler.ts:253)).
- But h3-dux's `DuxEndpoint.response` runs it through `InferMethodResponse`, which **unions the status map down to a single type** ([route-types.ts:194-196](dux/h3-dux/src/internal/route-types.ts:194), via [route-handler.ts:365](src/route-handler.ts:365)) — discarding the status discrimination the client would need.

If `DuxEndpoint` *preserved* the status→schema map instead of flattening it, then `api.safe.get(...)` could return a **discriminated, typed `error`** (`{ status: 404, data: NotFound } | { status: 422, data: Issues }`) — Elysia Treaty's headline trick — sourced from the *same* Standard Schema validation that already feeds OpenAPI. That's a genuine three-for-one (client types + runtime validation + docs) and it'd put h3-dux at or beyond Treaty rather than just catching Hono.

For SSE, the same `DuxError` should surface as a throw from the async iterator mid-stream.

(Smaller note, agreed with the prior agent: the standalone demo passes `fetch: app.request` ([demo/main.ts:12](dux/h3-dux/demo/main.ts:12)) — correct for in-process tests/SSR, dangerous if copy-pasted into a browser bundle. A named `createTestClient(app)` documents intent and prevents the footgun.)

One open decision worth your call: **throw-by-default vs result-by-default.** I recommend throw-by-default (data-first) with `.safe` for opt-in result handling — destructuring `{ data, error }` on every `/health` call is the boilerplate principle 2 forbids, but it's the *right* shape for forms/checkout flows. I'll flag this as a real fork decision below rather than assume it.

---

## Q3 — Nitro / file-based routing

**Verdict: the *client* is already portable to Nitro today; only the *type source* differs. The deltas split cleanly into "handler-time behaviors" (portable now) and "path-derived inference" (needs codegen). Lean on codegen — the expensive scanning is already done upstream.**

The tension you identified is exactly right: standalone passes the path as a *string literal* to `app.get(path, …)`, which is what powers param inference and route-map accumulation. File-based routing encodes the path in *filenames* (`routes/fruits/[id].get.ts`) that TS doesn't read into types. Today the Nitro demo papers over this with a **hand-written** route map ([demo/nitro/client.ts:9-13](dux/h3-dux/demo/nitro/client.ts:9)) and the file route falls back to upstream `defineRouteHandler` with an **explicit** `params` schema ([routes/fruits/[id].get.ts](dux/h3-dux/demo/nitro/routes/fruits/[id].get.ts)) — both are exactly the boilerplate/drift the vision opposes.

What I'd do:

1. **Generate the dux route map (the `nuxt prepare` analog).** Upstream already does file→route codegen for Nitro's `InternalApi` and OpenAPI. h3-dux's job is to make that generator additionally emit a **dux contract type** (`{ [route]: { [method]: DuxEndpoint } }`) so `createClient<Routes>()` reads a *generated* type — no hand-written `interface Routes`, no drift. The codegen already knows `[id]` → `:id`, so **param typing is recovered at generation time** rather than from a string literal.

2. **Split the deltas by what they need.** The runtime deltas — validation modes (`event.valid`, `eager: false`) and SSE streaming — are *handler-time* behaviors that don't need the path; they can be ported into the `defineRouteHandler` contract directly so file routes get them too. Only **param/route inference** needs the path, which codegen injects (e.g. stamping `RouteParams<'/fruits/:id'>` onto the handler's `~inferMethods`). Result: a file route gets `e.context.params.id: string` with *no* `params` schema, matching the standalone delight.

3. **The client API is already unified.** Verb sugar, path interpolation, and the data-first surface are pure route-map consumers — they work for Nitro the moment the generated map exists. The demo already proves `createClient<Routes>` is identical across modes; the only gap is *generating* `Routes` instead of hand-writing it.

So the dream — same `validate` block, `sse()`, `event.valid()`, response/param inference in both modes, differing only in "path from string" vs "path from filename + codegen" — is feasible. The moat is real (neither Hono nor Elysia has Nitro's file routing + codegen + OpenAPI), but it's currently underdelivered because the deltas don't reach file mode yet.

---

## Q4 — Honest ergonomics review (server + client)

**What's genuinely good and I'd keep:**
- `createServer`/`createClient` and `app.get`/`api.get` symmetry — reads well, low cognitive load, principle 5 made literal.
- **Response inference** (no hand-written `request<Receipt>`) — the headline win, real Hono/Elysia parity.
- **Param inference from the pattern** ([route-types.ts:74](dux/h3-dux/src/internal/route-types.ts:74)) — zero ceremony, lovely.
- **Both param spellings** — interpolation and keyed `{ params }` — covers both call-site preferences.
- The **`event.context.<scope>` neutral read + `event.valid()` deliberate validator** model ([dux-conventions.md](dux/docs/dux-conventions.md) §4) is *better than upstream's* `event.validated` bag; the eager/manual + dry-run story is a real strength.
- `sse()` → typed `AsyncGenerator<T>` with the `DuxCall` handle picking `await` vs `for await` by type ([sse.ts:65](dux/h3-dux/src/sse.ts:65)) — elegant.
- Superset/re-export-everything → no lock-in; plane separation as a lint rule. Strategically sound.

**What I'd change or watch:**
1. **Double-await** (Q2) — the biggest *felt* wart.
2. **Worst-case diagnostic** (Q1) — the biggest *DX* wart.
3. **No typed error channel** (Q2) — the client can't know what an endpoint can fail with.
4. **Multi-method routes repeat the path.** GET+POST on `/fruits` is `.get('/fruits',…).post('/fruits',…)`; upstream's `.route({ route, get, post })` groups them. The verb API trades grouping for symmetry — fine, but consider offering a grouped form too (ties into Q5/Q6).
5. **`event.valid()` is always async even in eager mode** — consistent, defensible, but worth a conscious "consistency over micro-optimization" note in the spec.

**New ideas worth proposing:**
- **OpenAPI from the standalone app.** Today OpenAPI is Nitro/codegen-side, but the standalone `createServer` accumulates the whole contract in `typeof app` — emitting an OpenAPI doc from it would make the planes symmetric (and is a nice "your routes are already the spec" story).
- **Client interceptors/hooks** (ofetch-style `onRequest`/`onResponse`/`onError`) for auth-header injection and token refresh — real apps need this and it keeps "auth is a header, not a concept" honest.
- **`createTestClient(app)`** (Q2).

---

## Q5 + Q6 — Modularity, composability, scale

**Verdict (the most important strategic finding): the *engine* is fully composable, but the *dux delta surface* is not yet. The scale-friendly path currently means dropping back to upstream ergonomics and losing the deltas. This is, in my view, the single biggest gap for "scale + highest DX."**

You're right that a single file of chained `.get().post()…` doesn't scale. The good news is the composition primitives already exist upstream and h3-dux re-exports them:

- `defineRoute({ route, get, post })` → a `RoutePlugin` carrying its typed contribution; `app.register(plugin)` accumulates ([route-handler.ts:592](src/route-handler.ts:592)).
- `defineRouteHandler(...)` (route-free) + `mountRoutes({ '/x': handler })` → a plugin carrying the aggregated map ([routes.ts:100](src/routes.ts:100)).
- `InferRoutes` / `InferRouteMap` / `MergePair` / `MergeAll` aggregate a single plugin, a **tuple of plugins**, or a route map into one contract ([routes.ts:66](src/routes.ts:66)), and `createClient` reads any of them via `NormalizeRoutes` ([typed-fetch.ts:15](src/typed-fetch.ts:15)).

So one-endpoint-per-file, per-domain grouping, and end aggregation are **already possible at the engine level** — and the client consumes them transparently. The problem: the dux deltas (verb authoring, validation modes, SSE, param-from-pattern inference) live *only* on the chaining `DuxServer` ([server.ts](dux/h3-dux/src/server.ts)). Compose via `defineRoute`/`mountRoutes` and you're back to upstream's `.route({…})` shape with no deltas.

What's needed (a delta worth specifying):
1. **A dux per-route primitive** that carries the deltas but isn't tied to the chain — a `defineRoute`-style definition with `validate` modes, `sse()`, response+param inference, aggregated by `createServer().register(...)` or by `createClient<[typeof a, typeof b]>()`.
2. **Scoped sub-apps with prefix mounting** — `parent.mount('/fruits', fruitsApp)` that prefixes routes and merges contracts, mirroring Hono's `app.route('/authors', authors)` and Elysia's `.use(plugin)` / `.group(prefix, …)`. The type-merge machinery (`MergePair`) already exists; dux needs a delta-aware wrapper.

Two things to document while you're here (both are industry footguns, not dux-specific): type accumulation requires **chaining** (separate `app.get(); app.get();` statements lose the accumulated type — same constraint Hono and Elysia have), and the *escape* from giant chains is exactly the plugin/sub-app composition above. Saying so explicitly is good DX.

---

## Q7 — Honest standing vs Hono and Elysia

**Verdict: not there yet, but the gap is small and the path is concrete. Today h3-dux is roughly "Hono-level safety with a nicer validation model and nicer SSE, but Hono-level client ergonomics, no typed errors, weaker composition ergonomics, and a worse worst-case diagnostic." Four fixes flip several of those to *leads*.**

| Axis | h3-dux today | Hono | Elysia | After the fixes |
|---|---|---|---|---|
| Response inference (e2e) | ✅ parity | ✅ | ✅ | ✅ parity |
| Client data access | ⚠️ double-await (= Hono) | ⚠️ double-await | ✅ data-first (Treaty) | ✅ **lead** (data-first) |
| Typed error channel | ❌ none | ◑ manual | ✅ Treaty | ✅ **match/lead** (status-map already upstream) |
| Validation control | ✅ eager/manual + dry-run | ◑ middleware | ◑ hooks | ✅ **lead** |
| Typed SSE on client | ✅ `AsyncGenerator<T>` | ◑ weaker | ✅ generators | ✅ parity/lead |
| Composition / scale | ⚠️ deltas not composable | ✅ mature | ✅ mature | ✅ parity (needs work) |
| File-based routing | ◑ moat, deltas missing | ❌ | ❌ | ✅ **unique moat** |
| Diagnostic quality | ❌ poor worst case | ❌ cryptic | ❌ cryptic | ✅ **lead** (tested contract) |
| Ecosystem / runtime | h3/Nitro/Nuxt | edge, huge | Bun-first, fast | — |

The reading: cryptic deep-generic errors are an **industry-wide** weakness (Elysia and Hono are both notorious for them), so making diagnostics a *tested contract* (Q1) is a place h3-dux can outright lead. Typed errors are *closer than for a greenfield library* because upstream already carries per-status response schemas (Q2). And Nitro file routing is a moat neither competitor has — once the deltas reach it (Q3).

To surpass them, in priority order:

1. **Diagnostics + cleaner inference (Q1)** — foundational (principle 3), low-risk, client-only; and every later feature adds generic complexity that benefits from a clean baseline. Lock it with Selenita as a contract.
2. **Data-first client + typed error channel (Q2)** — biggest felt win; design the typed-error contract alongside data-first since both touch the response contract.
3. **Delta-aware composition (Q5/Q6)** — the scale story; the type-merge primitives already exist.
4. **Nitro deltas via codegen (Q3)** — turns the moat real.

---

## Where I differ from the prior agent

I agree with their core calls: data-first `createClient` + `api.raw` + thrown `DuxError`; disjoint overloads; lock diagnostics with Selenita; no per-call `{ raw: true }`; no branded custom-error-string types; `createTestClient`. Three places I'd sharpen or diverge:

- **The diagnostic fix is deeper than "pass `VerbOptions` as the contextual type."** Because verbs *fix the method*, you can **drop the `O` generic capture entirely** and delete `NoExcess` (native excess-checking returns once the parameter type is concrete). That's a deletion, not a patch — the construct only exists to serve the bare `api(path, { method })` form, which verbs don't need.
- **Typed errors aren't "later."** Upstream's status→schema response map and `errors` option already exist; h3-dux is *flattening that information away* via `InferMethodResponse`. Preserve it and the typed error channel is a near-term win that feeds client types + runtime validation + OpenAPI at once.
- **Composition and Nitro-deltas deserve top-tier treatment** (the agent touched these lightly). The composition gap is, to me, the biggest strategic risk for the "scale + highest DX" promise.

---

## One decision I'd want from you before speccing

Everything above I'd act on with sensible defaults — except one genuine fork in the road for Q2 that changes the client's primary shape:

> For the redesigned client, which should be the *default* call shape (the other forms still ship alongside)? whatever is most honest and helpful to real use. for example, if i can do cost data = await api.get(path, opts) and data is Fruit, that's convenient, but is it honest? what if the fetch failed, or the server threw a http error? my intellisense will be blind to the possibility and i'll write buggy code that doesn't know an exception can occur, or which kind of exceptions are known. something like cost [error, data], mimicking go-go-trys pattern, or const { error, data } = ..., are a little less "minimal", but more honest about the real behavior we can expect, and push us to either handle exceptions or deliberately ignore them. still, these are just some musings, i don't know what the best shape is and i'm not prescribing anything (maybe i even misunderstood your propositions), but i hope you get the gist of what i'm trying to convey. also, i should repeat, this stage is not to update any docs or make a hyper detailed spec, it's more of the agreeing on an api/ergonomics/changes/additions/fixes we need to make to surpass the dx of the best libs in the space, and to address any of the current h3-dux gaps/weaknesses. it should be a super helpful analysis/report/recommendation/direction blueprint that helps drive the subsequent spec updates and implementation, but you shouldn't edit any of our existing docs directly yet.
> How far should the typed-error channel go in the first cut? Preserve status→schema in contract (Recommended)

Your honesty instinct is the right tiebreaker, and it actually *flips* my earlier default. Let me refine the client design around it, then fold everything into a consolidated direction blueprint — which is the deliverable you're after. No docs touched.

## The refined client: honest by default

You've put your finger on the real problem with `const data = await api.get(...) // Fruit`: it's *convenient but dishonest*. The type asserts `Fruit` while hiding two runtime realities — the transport can fail, and the server can return a typed HTTP error. That's a direct violation of principle 3 ("valid TypeScript should mean a valid request… errors at the cursor"). A type that can't fail, but does, is the cursor lying to you.

So I'd **make the honest result the default**, and make *throwing* the one-token, deliberate opt-out — the inverse of what I first proposed and of what the prior agent proposed. Everything hangs off the call handle (the existing `DuxCall`, which already overloads `await` vs `for await`), so there are no parallel namespaces to learn:

```TS
const api = createClient<App>({ baseURL })

// DEFAULT — the type shows failure is possible, so you must acknowledge it
const { data, error } = await api.get('/fruits/:id', { params: { id } })
if (error) {
  if (error.status === 404) {
    error.data
  }       // NotFound  (typed from the contract)
  else if (error.kind === 'transport') {}    // network/DNS/CORS — never reached the server
  return
}
data                                         // Fruit  (narrowed: error was falsy)

// DELIBERATE opt-out — "I want this to bubble" (scripts, SSR loaders, server-to-server)
const fruit = await api.get('/fruits/:id', { params: { id } }).orThrow()   // Fruit, throws DuxError

// WEB-STANDARD escape hatch — headers, status, streaming
const res = await api.get('/fruits/:id', { params: { id } }).raw()         // TypedResponse<Fruit>

// SSE — unchanged
for await (const tick of api.get(`/fruits/${id}/ripen`)) console.log(tick.ripeness)
```

Why this shape, specifically:

- **It's honest about *both* failure modes you named.** `error` is a discriminated union of `DuxHTTPError` (a typed non-2xx response) and `DuxTransportError` (the fetch never completed). `error.kind` separates them; `error.status` narrows the HTTP one. You can't accidentally treat a `Fruit` as present when it isn't, because `data` only narrows to `Fruit` after you've dealt with `error`.
- **It satisfies "handle or deliberately ignore."** Ignoring is not silent — it's the visible token `.orThrow()`. That reads as a decision, which is exactly what you wanted (Go's `_` made legible).
- **`.orThrow()` keeps the convenient one-liner** for the cases where bubbling is correct (a Nitro handler calling another service; a script). So you don't lose the terse path — you just have to *name* the choice to discard the error.
- **Object form over the Go tuple `[error, data]`.** Both are honest, but TypeScript's control-flow narrowing of *destructured* discriminated unions is far more reliable for `{ data, error }` than for tuple elements — `if (error) return; data` narrows cleanly with objects, flakily with tuples. Since the whole point is cursor-level honesty, I'd pick the form the compiler narrows best. (If you prefer the tuple aesthetic, it's offerable as a second shape, with that caveat noted.)
- **It degrades gracefully.** Even an endpoint that declares *no* error schemas still returns `{ data, error }` — `error.data` is just `unknown` there. Honesty holds everywhere; typing sharpens wherever the contract declares it.

This requires the typed-error channel you chose (preserve status→schema): `DuxEndpoint.response` must stop collapsing the per-status map through `InferMethodResponse` ([route-types.ts:194](dux/h3-dux/src/internal/route-types.ts:194)), and instead split it into a **2xx success projection** (→ `data`) and a **non-2xx projection** (→ `error.data`, discriminated by status). The raw material is already upstream — `ResponseValidation = SchemaWithJSON | Record<StatusCodeKey, SchemaWithJSON>` ([route-handler.ts:42](src/route-handler.ts:42)) and the `errors` auto-schemas for 400/415/500 ([route-handler.ts:253](src/route-handler.ts:253)) — so the same Standard Schema declaration feeds client types, runtime validation, *and* OpenAPI. That's the three-for-one that puts you at or past Elysia Treaty.

## The dream API, end to end

Server — composable across files, deltas intact, status→schema errors:

```TS
// fruits.routes.ts — a domain module, defined in isolation
export const fruits = defineRoutes()                    // delta-aware + route-free (the Q5/Q6 gap)
  .get('/fruits/:id', {
    validate: { response: { 200: FruitSchema, 404: NotFoundSchema } },
    handler: e => orchard.get(e.context.params.id),     // :id inferred string, no schema
  })
  .post('/fruits', {
    status: 201,
    validate: { body: NewFruitSchema, response: FruitSchema },
    handler: e => orchard.create(e.context.body),
  })

// app.ts — aggregate domains; prefix-mount scoped sub-apps
export const app = createServer()
  .mount(fruits)
  .mount('/admin', adminRoutes)        // Hono .route / Elysia .group parity, types merged
export type App = typeof app
```

Client — the honest surface above, identical whether `App` comes from `typeof app` (standalone) or a *generated* route map (Nitro). The only difference between modes is where the contract type originates.

## Consolidated blueprint (the agreed direction)

Ordered by dependency and value. Each is a "change/addition/fix," not a spec — that comes after.

| # | Workstream | What changes | Why it matters | Surface | Risk |
|---|---|---|---|---|---|
| **1** | **Diagnostics + cleaner inference** | Make the interpolation overload apply *only* to param routes (kills the doubled "Overload 1/2"); **drop the `O` generic + delete `NoExcess`** (verbs fix the method, so neither is needed — native excess-checking returns); add a flattening "client view" so valibot internals stop leaking. Lock it all with Selenita as a *contract* (one diagnostic, names the field, says missing/required, lands on `body`; hover stays readable across `forModes`). | The worst current DX wart; principle 3 made real. Low-risk, client-only. Clean baseline before adding generic complexity. | `client.ts`, `client.dx.test.ts` | Low |
| **2** | **Honest client + typed errors** | `{ data, error }` default; `.orThrow()` and `.raw()` on the handle; `DuxError` = `DuxHTTPError ∣ DuxTransportError`; **stop flattening status→schema** in `DuxEndpoint` so `error.data` is discriminated by status. `createTestClient(app)` for the in-process pattern. | Kills the double-await, fixes the "`.json()` typed as success on a 4xx" lie, and matches/beats Treaty. The biggest *felt* win. | `client.ts`, `sse.ts`, `route-types.ts` | Med |
| **3** | **Delta-aware composition** | `defineRoutes()` (route-free, carries the deltas) + `createServer().mount(sub)` / `.mount(prefix, sub)` merging contracts. The type-merge primitives already exist (`MergePair`, `RoutePlugin`, `NormalizeRoutes` accepts plugin arrays/maps). | The scale story. Today composing drops you back to upstream ergonomics and loses every delta — the biggest strategic gap. | `server.ts`, new `routes` builder | Med |
| **4** | **Nitro deltas via codegen** | Make the Nitro codegen emit the *dux* contract type (so `createClient<Routes>` reads a generated map, no hand-written `interface Routes`), inject the route literal so file routes get param inference with no `params` schema, and port the handler-time deltas (validation modes, SSE) into `defineRouteHandler`. | Turns the file-routing moat (which Hono/Elysia lack) from "underdelivered" into a real advantage. | `nitro.ts`, `codegen.ts`, `route-handler` port | Higher |
| **5** | **Symmetry extras (opt-in)** | OpenAPI from the standalone `createServer` (the contract is already in `typeof app`); client interceptors (`onRequest`/`onResponse`/`onError`) for auth/refresh. | Rounds out parity; keeps "auth is just a header" honest for real apps. | client + a codegen entry | Low–Med |

Do **1 first** (clean diagnostic baseline), **2 next** (it's what users feel), then **3** (scale) and **4** (moat) which are the larger strategic bets. 1 and 2 alone move you from "Hono-level ergonomics" to "ahead of Hono, at/past Treaty, and *leading* on diagnostic quality" — the last being something nobody in this space tests today.

Net read on your Q7 ("are we there yet?"): not today, but the gap is four concrete workstreams, two of them low-risk and client-only. The thesis — *most-delightful surface on the h3/Nitro foundation, with honesty and diagnostics as first-class, tested contracts* — is genuinely differentiated. The execution gaps are closable.

I'll save the agreed direction to memory so it's not re-derived next session, and leave all docs untouched as you asked.

Done. To recap the direction we landed on:

**The client gets reshaped around honesty, not minimalism.** Your point settled it — a type that says `Fruit` but can throw is the cursor lying. So `{ data, error }` becomes the default (`error` discriminated over typed HTTP statuses *and* transport failure), with `.orThrow()` as the legible one-token opt-out and `.raw()` as the web-standard escape hatch. That kills the double-await, fixes the "`.json()` typed as success on a 4xx" lie, and — because you chose to preserve status→schema — gives a typed error channel that matches/beats Elysia Treaty while feeding runtime validation and OpenAPI from the same declaration.

**The five workstreams, in order:** (1) fix the diagnostic + lock it as a Selenita contract — and note the sharpest lever there is that the verb client can *delete* `O` and `NoExcess` entirely since the verb fixes the method; (2) the honest client + typed errors; (3) delta-aware composition so domains can be split across files without losing the deltas; (4) Nitro deltas via codegen to make the file-routing moat real; (5) symmetry extras (standalone OpenAPI, interceptors).

**Honest standing vs the field:** today roughly Hono-level ergonomics with a nicer validation/SSE story but real gaps (double-await, no typed errors, weak composition, poor worst-case diagnostic). Workstreams 1–2 alone flip several of those to leads — diagnostic-quality-as-a-tested-contract being something nobody else does.

No docs or code were edited — this stays a direction blueprint for the spec/implementation phase. When you're ready to formalize, I'd suggest starting the spec with workstream 1 (smallest, lowest-risk, and it gives every later generic-heavy feature a clean diagnostic baseline to build on). I can also prototype the overload/`NoExcess` fix against the real types to confirm the before/after message whenever you want hard evidence for the expert.
