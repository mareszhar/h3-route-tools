# Orchard — the h3-dux demo

One small fruit-market API, shown two ways with `@mszr/h3-dux`:

- **Standalone (h3 only)** — this folder. A `createServer()` app and a `createClient()` trip, runnable with bun.
- **Nitro (file-based)** — [`nitro/`](./nitro). The same API as file routes, with Nitro codegen + OpenAPI.

Both are typed end-to-end: the server is the single source of truth, and the client is derived from it.

## Standalone (h3 only)

```bash
bun run trip     # narrated in-process client trip across every endpoint
bun run serve    # serve on http://localhost:3000 to poke by hand
```

[`server.ts`](./server.ts) puts every delta on display:

- **Per-verb authoring** — `app.get('/fruits/:id', { … })`, symmetric with the client's `api.get`.
- **Response inference** — `/health` declares no response schema; the client still sees `{ status: 'ripe'; at: string }`.
- **Param inference** — `/fruits/:id` types `e.context.params.id` as `string` with no schema.
- **Validation modes** — `/import` uses `eager: false` + `event.valid('query' | 'body')`; a dry-run never touches the body.
- **Typed SSE** — `/fruits/:id/ripen` uses `sse(RipenTickSchema)`; the client `for await`s an `AsyncGenerator<RipenTick>`.
- **Typed errors** — `/fruits/:id` declares `errors: { 404: ErrorSchema }` and throws the cursor-checked `e.error(404, …)`; the client's `error` is discriminated by status.
- **Response kinds** — `/motd` returns a bare string, `/fruits/:id/label` a bare Blob, and both infer without markers; `DELETE /fruits/:id` returns `204` (the `empty` kind).

[`main.ts`](./main.ts) drives them through the **honest client**: every call resolves to `{ data, error }`, with `.orThrow()` for the value and `.raw()` for the native response plus its universal `.parse()` reader. Watch the trip print a typed `422` on an invalid body and a typed `404` for a missing fruit — `error.data` is the declared shape, never the transport envelope. Response shapes, path params, request bodies, the SSE element type, and the per-status error bodies are all inferred from `typeof app`.

## Nitro (file-based)

```bash
cd nitro
bun run prep     # nitro prepare — generates route types
bun run dev      # nitro dev on http://localhost:3000  (Scalar UI at /_scalar)
```

> Requires the package to be built first (`bun run sdk:build:ours` from the dux workspace), because Nitro resolves `@mszr/h3-dux/nitro` from the package's `dist`, not from source.

Each [`routes/**`](./nitro/routes) file's default export is a `defineRouteHandler`; the Nitro module unions their contracts into nitro's `InternalApi` and the OpenAPI document. [`client.ts`](./nitro/client.ts) types a client from a **type-only** route map (`typeof import('./routes/...').default`) — no runtime import, no client-bundle cost.

> The dux deltas (verb authoring, validation modes, SSE) live on the standalone `createServer` builder. Nitro file routes use the inherited upstream `defineRouteHandler` contract; bringing the deltas to file routes is a noted future enhancement ([dux-vision.md §4.3](../../docs/dux-vision.md)).
