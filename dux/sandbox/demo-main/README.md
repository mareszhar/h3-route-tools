# Orchard — the h3-dux demo

One small fruit-market API, shown two ways with `@mszr/h3-dux`:

- **Standalone (h3 only)** — [`standalone/`](./standalone). `server/` holds the `createServer()` app and `client/` holds the narrated trip.
- **Nitro (file-based)** — [`nitro/`](./nitro). `server/` holds the file routes and `client/` holds the generated-route client example.

Both are typed end-to-end: the server is the single source of truth, and the client is derived from it.

## Standalone (h3 only)

```bash
cd standalone
bun run trip     # narrated in-process client trip across every endpoint
bun run serve    # serve on http://localhost:3000 to poke by hand
```

[`server/app.ts`](./standalone/server/app.ts) puts every delta on display:

- **Per-verb authoring** — `app.get('/fruits/:id', { … })`, symmetric with the client's `api.get`.
- **Response inference** — `/health` declares no response schema; the client still sees `{ status: 'ripe'; at: string }`.
- **Param inference** — `/fruits/:id` types `e.context.params.id` as `string` with no schema.
- **Validation modes** — `/import` uses `eager: false` + `event.valid('query' | 'body')`; a dry-run never touches the body.
- **Typed SSE** — `/fruits/:id/ripen` uses `sse(RipenTickSchema)`; the client `for await`s an `AsyncGenerator<RipenTick>`.
- **Typed errors** — `/fruits/:id` declares `errors: { 404: ErrorSchema }` and throws the cursor-checked `e.error(404, …)`; the client's `error` is discriminated by status.
- **Response kinds** — `/motd` returns a bare string, `/fruits/:id/label` a bare Blob, and both infer without markers; `DELETE /fruits/:id` returns `204` (the `empty` kind).

[`client/trip.ts`](./standalone/client/trip.ts) drives them through the **honest client**: every call resolves to `{ data, error }`, with `.orThrow()` for the value and `.raw()` for the native response plus its universal `.parse()` reader. Watch the trip print a typed `422` on an invalid body and a typed `404` for a missing fruit — `error.data` is the declared shape, never the transport envelope. Response shapes, path params, request bodies, the SSE element type, and the per-status error bodies are all inferred from `typeof app`.

## Nitro (file-based)

```bash
cd nitro
bun run prep     # nitro prepare — generates route types
bun run dev      # nitro dev on http://localhost:3000  (Scalar UI at /_scalar)
```

> Requires the package to be built first (`bun run sdk:build:ours` from the dux workspace), because Nitro resolves `@mszr/h3-dux/nitro` from the package's `dist`, not from source.

Each [`server/routes/**`](./nitro/server/routes) file's default export is a dux-native `defineFileRoute` (delta 13): the filename owns the path and method, and the handler carries every standalone delta. On `nitro prepare`/`dev`/`build` the Nitro module generates `#h3-dux/routes` from those files — a schema-free kernel route map, re-keyed per filename method — and [`client/index.ts`](./nitro/client/index.ts) types its client straight from it (`createClient<Routes>()`), with no hand-written route interface. The same projection also rewrites Nitro's `InternalApi`/`$fetch` success type; OpenAPI enrichment for dux file routes is intentionally deferred to phase 10.

> The generated module is emitted as a `.ts` (not a `.d.ts`) so its filename-truth assertions are checked even under Nitro's `skipLibCheck` — declare `params: { slug }` on `server/routes/fruits/[id].get.ts` and `tsc` reports the disagreement at the cursor. See [dux-spec.md §13](../../docs/dux-spec.md#13-nitro-deltas-via-codegen).
