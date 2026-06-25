# h3-dux — vision

> h3-dux is a DX/UX-first reimagining of h3 that expands on the work laid out by [`h3-route-tools`](https://github.com/sandros94/h3-route-tools). It keeps h3 and Nitro exactly as they are, inherits everything the upstream library already does well, and reshapes the authoring surface around one question: *what would feel most delightful to use?*

This is the hub: the philosophy, the principles, the architecture, the scope, and the model that keeps the fork alive. Everything operational lives in the docs it indexes ([§8](#8-the-docs)).

- [1. What h3-dux is](#1-what-h3-dux-is)
- [2. Why a fork, not a wrapper](#2-why-a-fork-not-a-wrapper)
- [3. Design principles](#3-design-principles)
- [4. Architecture](#4-architecture)
- [5. The deltas](#5-the-deltas)
- [6. The scope edge](#6-the-scope-edge)
- [7. How h3-dux stays alive](#7-how-h3-dux-stays-alive)
- [8. The docs](#8-the-docs)

---

## 1. What h3-dux is

`@mszr/h3-dux` gives an h3 v2 / Nitro v3 app **end-to-end type safety**: a server you author with typed, validated routes, and a client typed entirely from that server's `typeof app` — no hand-written response types, no drift.

The hard problem is already solved upstream. h3-route-tools accumulates every route's contract into the app's type, validates params/query/body/headers/response through [Standard Schema](https://standardschema.dev), ships a [fetchdts](https://github.com/unjs/fetchdts)-style typed client, and carries the whole thing into Nitro with file-based codegen and OpenAPI. h3-dux builds **on top of that**, not around it: we inherit the engine and refine the surface.

### The one hard contract

> **h3-dux owes behavioral compatibility to h3 and Nitro, not API compatibility to any SDK.**

Everything h3-dux emits is something h3/Nitro already understand, and we track upstream `h3-route-tools` closely so fixes and features flow both ways. Inside that envelope the ergonomics are ours. h3-dux is not a drop-in for h3-route-tools and doesn't pretend to be — but because it is a strict **superset** (it re-exports the entire upstream surface), adopting it is never a lock-in.

### Primary user

h3-dux is built first for its maintainer: opinionated, deliberate, optimized for delight over the widest API.

---

## 2. Why a fork, not a wrapper

The deltas we want split unevenly. One is purely additive (client verb sugar); three reach into the *accumulating-generic builder* and the client's *return-type derivation* (server verb authoring, typed SSE, validation modes). Wrapping someone else's accumulating-generic builder from the outside while preserving inference is notoriously brittle — you end up with a fragile additive layer beside a can't-be-additive split.

So we fork. We implement the deltas **inside** the surface, on the `dux` branch, keeping `main` a clean upstream mirror for easy diffing. The generalizable deltas (SSE, verb sugar, validation modes) are good upstream-PR candidates; in the ideal case they land there and our fork shrinks toward zero.

| What we want | h3-route-tools today | Our path |
| --- | --- | --- |
| Route param typing (server + client) | ✅ `event.context.params`, client `params: { id }` | inherit + add `event.params` alias and mounted-prefix requirements |
| `validate: {}` nesting (params/query/body/headers/response) | ✅ per method | inherit |
| Standard Schema (zod / valibot) | ✅ | inherit |
| Nitro file-based codegen | ✅ — *the expensive part* | inherit |
| OpenAPI 3.1 generation | ✅ | inherit |
| Cascading custom validation errors | ✅ `onValidationError` (app → route → method) | inherit |
| `api.get(path, opts)` client verb sugar | ❌ only `api(path, { method })` | **add** (additive) |
| `app.get(path, opts)` server authoring | ❌ only `.route({ route, get })` | **add** (builder) |
| Path interpolation `api.get(\`/f/${id}\`)` | ❌ only the `params` key | **add** (client types) |
| Typed SSE streaming | ◑ doc-only `stream` slot; client return is JSON | **add** (client + brand) |
| Eager-sequential / manual validation modes | ◑ validates all, fixed order, no manual | **add** (modes) |

The five **add** rows are [§5](#5-the-deltas); each is specified in [dux-spec.md](./dux-spec.md).

---

## 3. Design principles

The canon. When two pull against each other, the earlier one wins.

1. **Delightful.** Every decision answers "what would feel most delightful to use?" The best API disappears — you think about your routes, not the library. When several designs work, pick the one that fits the mental model of the person reading and writing the code.

2. **Boilerplate is an active harm.** Every repeated shape the library could erase and doesn't is a failure. DRY runs both ways: erase repetition in userland (`request<T>` asserted by hand, manual SSE parsing) *and* keep one source of truth per concept inside h3-dux, so a fix lands once and every surface inherits it.

3. **Errors at the cursor, not the console.** The type system is the first safety layer: valid TypeScript should mean a valid request. When something is wrong, the error lands on the offending piece — the bad field, the undeclared body, the wrong method — with a message you can act on. And the type must not *lie* about runtime: a call that can fail returns a value whose type says so, so the failure is handled at the cursor instead of surfacing later as an unhandled throw. A value typed `Fruit` that can actually reject is the cursor lying to you.

4. **Self-documenting.** Names match mental models; types are as narrow as they can be without becoming hard to use. `createServer` and `createClient` read as counterparts because they are. Comments explain *why*; the code explains the *what*.

5. **Predictable contracts.** Learn one surface, know the rest. The server verb you author and the client verb you call are the same word. One validated-data model across eager and manual. No surprises between siblings.

6. **Additive, never divergent — at the baseline.** The upstream surface is re-exported, not rewritten. Our creativity lives in the layer we add; anything with an upstream counterpart is mirrored, so porting stays mechanical ([§7](#7-how-h3-dux-stays-alive)).

7. **Plane separation is a lint rule.** The server, client, and Nitro planes keep their boundaries because the linter checks them, not because we remember to. "A Nitro import leaked into the client" is a build error.

8. **Elegance is a requirement.** The implementation reads with the clarity the API projects. If a piece can't be explained simply, it isn't done.

9. **Power is opt-in; the simple path never pays for it.** Simplicity is the ultimate sophistication. Supporting a powerful case — typed errors, response kinds, composition, typed context — must never add ceremony to the case that doesn't need it. A route that declares no errors, a handler that returns plain JSON, a one-file app: each stays exactly as small as it was. New capability arrives as something you reach for when the moment calls for it, never as a tax levied by default. "*Now supported*" must not make "*not needed*" any harder.

---

## 4. Architecture

### 4.1 One package, three entrypoints

```
@mszr/h3-dux           the standalone plane: createServer (typed route builder), createClient
                       (typed fetch), defineRoute, sse, schema/validation helpers, the typed-fetch types
@mszr/h3-dux/nitro     the Nitro module for file-based routes + its codegen glue
@mszr/h3-dux/codegen   the route-types / OpenAPI generators the module and CLI use
```

The root is where authoring happens; `/nitro` and `/codegen` mirror upstream so a Nitro app gets the same end-to-end typing as the standalone builder. Keep the entrypoint count minimal — every subpath is a maintenance and docs surface.

### 4.2 Three planes, one source of truth

```
        define a route ──▶ accumulates into `typeof app` ──▶ derives the client
        (server plane)        (the shared contract)            (client plane)
                                     │
                                     ▼
                         Nitro file-based codegen
                         (emits the same contract as .d.ts)
```

Everything flows from **one contract per route** — the `validate` block plus the handler. The server registers it, the app's type accumulates it, the client is derived from it, and Nitro regenerates it from the filesystem. The DRY win is that no surface re-declares what another already knows: a response type is written once (or inferred once) and read everywhere.

### 4.3 Inherited vs ours

| Plane | Inherited from h3-route-tools | Added by h3-dux |
| --- | --- | --- |
| Server | `H3Typed`, `.route()`, `validate`, `onValidationError`, `defineRoute`/`register` | `createServer`, `app.get/post/…`, response + param inference, validation modes, SSE streaming, **`createRouter`/`.mount` composition, typed middleware bindings, root event accessors, `event.error()`** |
| Client | `createTypedFetch`, params/query/body/response typing | `createClient`, `api.get/…`, path interpolation, SSE `AsyncGenerator`, **honest `{ data, error }` surface, `.orThrow()`/`.raw()`, typed error channel, interceptors** |
| Contract | per-method `Endpoint`, status→schema response map, `errors` | **the normalized kernel: plain shapes, per-status responses, response kinds** |
| Nitro | `defineRouteHandler`, module, codegen, OpenAPI | **`defineFileRoute`/file-route factories, generated kernel route map (no hand-written `Routes`), filename-derived client params** |

### 4.4 The contract kernel

The contract each route accumulates is, today, schema-shaped: `typeof app` carries the literal valibot/zod types, and every surface that reads it (the client, diagnostics, Nitro, OpenAPI) re-derives the plain shape it actually needs. That re-derivation is where the inferred types turn intricate, where schema internals leak into diagnostics, and where the response collapses to a single type and loses its per-status structure.

The next evolution normalizes that contract once, at accumulation time, into a **kernel** every plane consumes verbatim:

```
EndpointContract
  request   { params, query, headers, body }     ← plain, resolved shapes (no schema generics)
  responses { [status]: { body, kind } }          ← per-status; kind = json|text|empty|sse|binary
  success   the 2xx status this endpoint answers with
```

One normalized contract, read identically by the client (success → `data`, non-2xx → typed `error`), by diagnostics (plain shapes, no `ObjectSchema<…>` to print), by composition (merge kernels, prefix paths), by Nitro codegen (emit the kernel per file route), and by OpenAPI (the kernel *is* the spec). This is the spine of Generation 2 ([§5](#5-the-deltas)): every later delta is a producer or consumer of the kernel, which is why they compose instead of colliding. The schema is still the source of truth — the kernel is its resolved, public projection, computed once.

---

## 5. The deltas

The work that makes h3-dux more than a rename. Each is a contract in [dux-spec.md](./dux-spec.md); this is the status view, in two generations.

### Generation 1 — the authoring surface (shipped)

| # | Delta | Status |
| --- | --- | --- |
| 1 | Per-verb **server** authoring — `app.get(path, opts)` over `.route({ route, get })`, preserving accumulation (+ response & param inference) | ☑ done |
| 2 | Per-verb **client** sugar — `api.get(path, opts)` over `createClient`; bare `api(path, { method })` stays | ☑ done |
| 3 | Client **path-param interpolation** — `api.get(\`/fruits/${id}\`)` beside the keyed `params` form | ☑ done |
| 4 | **Typed SSE** — `sse(schema)` brands `validate.response`; client returns `AsyncGenerator<T>` | ☑ done |
| 5 | **Validation modes** — eager-sequential default; `eager: false` → manual via `event.valid('scope')` | ☑ done |

All five are implemented, each with runtime, type, and editor-DX tests. The package also re-exports the full upstream surface unchanged.

### Generation 2 — honesty, errors, scale (the next evolution)

Generation 1 made authoring delightful and reached *Hono-level* end-to-end safety. Generation 2 is what takes h3-dux *past* Hono and Elysia: an honest client, a typed error channel, composition that scales, typed middleware bindings, and the Nitro file-routing moat made real — all resting on the contract kernel ([§4.4](#44-the-contract-kernel)). Ordered by dependency and phase, not by raw value.

| # | Delta | Phase | Status |
| --- | --- | --- | --- |
| 6 | **Cleaner inference + diagnostics-as-contract** — one call signature, drop the `O`/`NoExcess` machinery, flatten schema leakage; lock the message as a Selenita contract | 5 | ☑ done |
| 7 | **The contract kernel** — normalize each endpoint into plain, per-status shapes at accumulation time ([§4.4](#44-the-contract-kernel)) | 6 | ☑ done |
| 8 | **The honest client** — `{ data, error }` by default; `.orThrow()` and `.raw()` on the call handle; `DuxError = HTTP \| transport` | 6 | ☑ done |
| 9 | **Typed error contracts** — preserve status→schema; `errors: { 409: … }`; `event.error(status, data)`; one envelope, standardized on `422` | 6 | ☑ done |
| 10 | **Response kinds** — infer `json/text/empty/sse/binary`, type native bodies with `typedResponse`, add raw `.parse()`; harden SSE | 7 | ☑ done |
| 11 | **Delta-aware composition** — prefix-carrying `createRouter`, `createServer().mount(router)` with optional outer prefix, `.register` accumulation, duplicate-route diagnostics | 8 | ☑ done |
| 12 | **Typed middleware bindings** — `defineMiddleware` infers staged private values and downstream `event.bindings`; `requires` checks parent capabilities without re-registering middleware | 8 | ☑ done |
| 13 | **Nitro deltas via codegen** — `defineFileRoute` + capability-carrying factories; generate the kernel route map; filename-derived client params | 9 | ☑ done |
| 14 | **Symmetry extras** — OpenAPI from the standalone `createServer`; client interceptors / `signal` / timeout / retry | 10 | ☐ planned |

Per-delta contracts, usage, and phasing: [dux-spec.md](./dux-spec.md).

---

## 6. The scope edge

A garden's wall is a promise: opting into h3-dux never locks you out of something h3 or Nitro can do — h3-dux is a superset, and any escape hatch is the upstream surface we already re-export.

- **In scope:** typed server authoring, the derived client (now honest about failure), typed SSE, validation control, **a typed error channel**, **response-kind fidelity**, **composition that carries the deltas**, **typed middleware bindings**, **OpenAPI from the standalone app**, and everything h3-route-tools already ships (Nitro codegen, OpenAPI, custom validation errors).
- **Pass-through, not a concept:** **auth.** A protected route is `middleware: [...]`; an authenticated client call is a header. h3-dux adds no auth primitive — it would be app-specific. Typed middleware bindings (delta 12) are the general capability mechanism through which any middleware — auth or otherwise — publishes request-scoped values; auth remains an app concern.
- **Out of scope:** anything that isn't h3/Nitro route typing. Other frameworks (Hono, Elysia) are reference points and competitive bars in `archive/` — we study what they do best and adopt it the dux way (or better) — but they are not compatibility targets.

---

## 7. How h3-dux stays alive

The goal: porting upstream changes stays mechanical forever.

- **`main` is the mirror; `dux` is the work.** `main` tracks `h3-route-tools` untouched, so a rebase is a clean fast-forward and any diff against upstream is exactly our delta. We develop on `dux`.
- **`dux/` is the edit home.** Almost everything we own lives under `dux/` — the package, the docs, our linting, our scripts. Files outside `dux/` change only when unavoidable (ignore globs, a CI guard). This is what keeps rebasing trivial.
- **Re-export, don't reimplement.** The package is a superset of upstream; our additions sit beside the re-exports. When upstream moves, typecheck breaks loudly at the wrap points and we re-apply only our delta.
- **Upstream-first.** The generalizable deltas are proposed to h3-route-tools on a separate branch. If they land, our fork shrinks.

The maintainer mechanics — build, test, lint, drift, publish — are [dux-spec-workspace.md](./dux-spec-workspace.md).

---

## 8. The docs

One hub (this), one cross-cutting law, one deltas spec, one maintainer manual. When a delta changes, exactly one spec entry changes with it.

| Doc | Role |
| --- | --- |
| [dux-vision.md](./dux-vision.md) | **the hub** — philosophy, principles, architecture, scope, sustainability |
| [dux-conventions.md](./dux-conventions.md) | cross-cutting law: vocabulary, fetchdts alignment, the validated-data model, the naming map |
| [dux-spec.md](./dux-spec.md) | the five deltas, each as *why → proposed approach → status*, with its usage snippet |
| [dux-spec-workspace.md](./dux-spec-workspace.md) | maintainer manual: layout, build, boundaries, testing, fork-rebase, publishing |

Specs are **contract-driven**: each entry headlines the desired behavior and why it matters, then proposes an implementation. If reality teaches a better implementation, the proposal moves; the contract above it stays.
