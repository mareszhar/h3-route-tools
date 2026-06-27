# proposal expert S

> Historical draft. This memo predates Generation 2 and is kept as design archaeology only. It is superseded by [dux-vision.md](../dux-vision.md), [dux-language.md](../dux-language.md), [dux-patterns.md](../dux-patterns.md), and [dux-spec.md](../dux-spec.md); do not treat recommendations or status claims here as current h3-dux guidance.

I read through `dux-vision.md`, `dux-conventions.md`, `dux-spec.md`, [server.ts](dux/h3-dux/src/server.ts), [client.ts](dux/h3-dux/src/client.ts), [route-types.ts](dux/h3-dux/src/internal/route-types.ts), the demo, the Nitro demo client, and upstream's `h3-typed.ts`/`nitro.ts`/`codegen.ts`. Here's my own read on each point — I cross-checked the other agent's report against the code rather than taking it on faith, and I diverge from it in a couple of places.

## 1. The diagnostic problem — feasible, contained, no upstream rewrite

Confirmed: `client.ts` is 100% dux-owned (upstream doesn't export this machinery). Two separate, fixable causes:

**A. The overloads aren't disjoint.** [`VerbFetch`](dux/h3-dux/src/client.ts:116) has two overloads — literal pattern, and interpolated template. `PathTemplate<'/fruits'>` ([client.ts:63](dux/h3-dux/src/client.ts:63)) returns `/fruits` unchanged when there's no `:param`, so a static route like `/fruits` satisfies *both* `VerbPatterns` and `VerbTemplates`. TS then dumps "Overload 1 of 2" and "Overload 2 of 2" with near-identical text — that's literally the duplication you're seeing. Fix: exclude routes with no `:` from the interpolation overload's candidate set (the inverse of the existing `NotPattern` guard). One small type change, immediately halves the noise.

**B. The options parameter is generic when it doesn't need to be.** `VerbArgs` infers `O extends VerbOptions<E, WithParams>` and threads it through `NoExcess` ([client.ts:97-100](dux/h3-dux/src/client.ts:97)). That's why the error dumps the whole resolved generic tree instead of TS's native "Property X is missing" against a plain object type. `O` only needs to be generic if something downstream reads it back — nothing does. Drop the inference, type the parameter as `VerbOptions<E, WithParams>` directly, and native excess-property checking on the object literal kicks in for free — no `NoExcess` needed at all for that purpose. This is the highest-leverage fix and the one I'd do first.

I'd also flag that `NoExcess` is doing very little real work — it only blocks unknown *top-level* option keys, not excess fields inside `body`. The actual error you hit (`stockKg` missing) comes from native structural checking against `VerbOptions`, not from `NoExcess` at all. It's mostly diagnostic noise for limited protection — worth reconsidering once (A) and (B) land, since plain contextual typing of a non-generic parameter may make it redundant.

**Hover noise** (the `SerializeObject<{...}>` wall) is a separate, cheaper problem and not a framework bug — TS always expands anonymous mapped types. The fix lives in *your* schemas, not the kit: `interface Fruit extends v.InferOutput<typeof FruitSchema> {}` collapses the hover to `Fruit`. Worth a line in `dux-conventions.md` as a house convention, since it's zero-cost and directly serves principle 4.

**Selenita**: confirmed [client.dx.test.ts:30-36](dux/h3-dux/src/client.dx.test.ts:30) only asserts `/not assignable/` exists — it proves an error fires, not that it's good. I'd strengthen it to assert: exactly one diagnostic, it names `stockKg`, it says "missing", and it lands on `body`. That's the test that would have caught this regression and should gate the fix.

None of this requires touching upstream. It's a contained client.ts change — call it delta 6.

## 2. Response/error ergonomics — I agree with data-first, with one addition

The double-await is real and worth fixing. I'd make `createClient`'s verb methods data-first by default — `await api.get(...)` returns the body, throws on non-2xx — and add `api.raw.get(...)` for the `Response`/headers/status escape hatch. This is the right shape because:

- It matches the principle ordering directly: boilerplate erased (principle 2) without losing the standard underneath (principle 6 — `api.raw` is still the exact `TypedFetch` you have today).
- `DuxCall`'s existing dual-consumption trick (`await` vs `for await`, [client.ts:161-168](dux/h3-dux/src/client.ts:161)) already proves the kit is comfortable branching behavior on *how* the caller consumes the return — extending that same handle with a throwing `.then()` is consistent with code you already have, not a new paradigm.
- A `{ data, error }` result-union as the *default* is the wrong call — it taxes every successful call for a benefit (typed error union) you don't actually have yet, since `DuxEndpoint` carries no error-response contract today. I'd defer a real Elysia-treaty-style typed error map to its own future delta once `validate` grows an `errors: { 404: Schema }` slot that feeds both OpenAPI and the client — that's a bigger, separate piece of work, not a prerequisite for fixing the awkward double-await now. Ship `DuxFetchError { status, data: unknown, response }` first; type the `data` later.

## 3. Nitro + path-based client — already works, the gap is codegen, not architecture

This is the one where I have new, concrete information: **the pattern you asked about already exists and works today.** [`demo/nitro/client.ts`](dux/h3-dux/demo/nitro/client.ts) hand-writes:

```TS
interface Routes {
  '/health': typeof import('./routes/health.get').default
  '/fruits/:id': typeof import('./routes/fruits/[id].get').default
}
export const api = createClient<Routes>({ baseURL: 'http://localhost:3000' })
```

and `createClient<Routes>` gives you the full `api.get('/fruits/:id', { params })` / interpolation ergonomics — params, body, query, response, all of it — because each `typeof import(...).default` is the *whole* `defineRouteHandler` contract, not just the response. So the standalone and Nitro clients are already the same `createClient`, same types, same DX. Nothing architectural is missing.

The actual gap is exactly what you suspected: that `Routes` interface is **hand-maintained**, one line per route file — which is boilerplate principle 2 explicitly forbids, and it'll drift the moment someone adds a file and forgets the client.

The good news: upstream already has the hook to fix this without a separate `nuxt prepare`-style command. `extendRouteTypes` ([nitro.ts:111](dux/h3-route-tools/src/nitro.ts) — upstream, not dux) runs on nitro's `types:extend` lifecycle and already rewrites `nitro-routes.d.ts`'s `InternalApi` per route — but only with `Simplify<Serialize<Awaited<ReturnType<...>>>>` (response only), which is why the generated `.nitro/types/nitro-routes.d.ts` you have today is response-shape-only. The fix is additive: hook the same `types:extend` lifecycle to emit a second virtual module containing exactly the hand-written `Routes` interface above (`typeof import(...).default` per route, scanned from the filesystem), and have `@mszr/h3-dux/nitro` re-export a typed `createClient` pre-bound to it. That gets you regenerated, zero-maintenance route types every time nitro's dev server or `nitro prepare` runs — for free, since it rides the same hook nitro already fires, not a new build step you ask users to remember.

I'd write this up as a new delta (#6 in dux-spec.md) rather than improvising it inline — it's genuinely additive to `nitro.ts` and doesn't touch the standalone plane at all.

## 4. Honest review of current ergonomics

**Land well:** server/client verb symmetry, response+param zero-ceremony inference, dual literal/interpolated params, and the `DuxCall` SSE trick are all genuinely Hono/Elysia-tier and well-executed. The decision to keep the client as verb+literal-path rather than an Eden-style proxy chain (`dux-conventions.md §2`) is correct and I'd defend it as-is — string routes stay grep-able and feed OpenAPI/codegen; a proxy chain trades that for cuteness.

**Real gaps**, beyond the diagnostic and consumption issues above:

- **No typed error contract.** Already covered (#2) — this is the single biggest distance from Elysia's treaty.
- **No typed middleware context.** `middleware: [...]` is plain h3 passthrough — if `requireKey` attaches `event.context.user`, nothing downstream knows that without a manual cast. This isn't an auth primitive (vision §6 correctly keeps auth out), it's a typing primitive: a way for *any* middleware to register what it adds to context, à la Hono's `Variables` generic. Worth considering as its own delta, decoupled from auth.
- **Cross-file composition doesn't actually compose** — see #5, this is the most concrete gap I found.

## 5. Composability — not yet, and I found exactly where it breaks

Upstream does have a real cross-file mechanism: `defineRoute({...})` produces a `RoutePlugin`, and `H3Typed.register(plugin)` ([h3-typed.ts:63](dux/h3-route-tools/src/h3-typed.ts:63)) folds `InferRouteTypes<P>` into the app's accumulated `Routes` generic via `MergePair` — the same merge mechanism the verb methods use. So upstream's own answer to "one route per file" is `defineRoute` + `.register()`.

But `DuxServer` ([server.ts:187](dux/h3-dux/src/server.ts:187)) doesn't expose `.register()` at all — only `.use()`, `.app` (the raw escape hatch), and the verb methods. `DuxServer`'s `~duxRoutes` marker is tracked independently of `H3Typed`'s own generic, and the verb methods hardcode their own `DuxNext` return type per call — they don't read back whatever happened to `this.app`. So if you drop to `app.app.register(someRoutePlugin)` today, the inner `H3Typed` instance's type *does* accumulate correctly, but `DuxServer`'s own accumulated type — the one `createClient<typeof app>()` actually reads via `~duxRoutes` — never sees it. **Concretely: composing routes defined in another file via upstream's own composition primitive silently breaks the dux server's type, today.**

This is fixable the same way the five existing deltas were: add a `DuxServer.register()` that mirrors the verb methods exactly — forward to `this.app.register(plugin)`, capture `InferRouteTypes<P>`, fold it into `~duxRoutes` via the same `MergePair` you already use in `DuxNext`. That's a small, consistent addition, not a redesign — it just closes a gap where dux's wrapper didn't keep pace with one of upstream's own composition primitives. I'd treat "is h3-dux scale-friendly" as **no, not yet, but the fix is a half-day, well-understood delta**, not an open research question.

## 6. Honest comparison to Hono/Elysia

Not there yet, and I'd name the gap precisely rather than vaguely: **inference quality and consumption ergonomics, not architecture.** The server/client symmetry, zero-ceremony inference, and SSE story are already at or above Hono/Elysia's bar. What's missing is the stuff that makes Elysia's *failure modes* feel as good as its happy path — readable diagnostics (#1) and a typed error/result story (#2) — plus the boilerplate tax of the double-await (#2) and the hand-maintained Nitro route map (#3). All four are contained, scoped fixes you've already half-diagnosed correctly in your own questions; none of them require reaching into upstream. Land #1 and #2 and you're at parity on DX; land #3 and #5 and you're ahead on the Nitro/file-based story specifically, since neither Hono nor Elysia has Nitro's filesystem-router integration to begin with.

## 7. On the other agent's report

I agree with its core recommendation (data-first client + `.raw`, fix the overload/generic issue in client types, defer typed errors). Two places I'd push back or add:

- It frames the Nitro client question as mostly open ("what's most ideal and feasible") — I'd say it's *already answered* by your own demo code; the gap is purely codegen automation, not API design.
- It doesn't surface the cross-file composability bug at all (#5) — that one I found by reading `h3-typed.ts`'s `register()` against `DuxServer`'s lack of one, not something either of us guessed at.

---

If you want, I can turn the four concrete, scoped fixes (diagnostic disjointness + generic options, data-first client + `.raw`, Nitro route-map codegen, `DuxServer.register()`) into dux-spec.md entries before any code changes — that's the natural next step given how the existing five deltas are documented.
