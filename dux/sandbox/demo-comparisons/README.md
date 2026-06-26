# Orchard comparisons

One small fruit-market API, implemented across **h3**, **h3-dux**, **Hono**, and **Elysia**. Each SDK has a `standalone/` demo and a `nitro/` demo, so the ergonomics comparison is visible directly in the folder tree.

Every backend exposes the same API and shares the SDK-agnostic Orchard domain from `fixtures/` (`@orchard/domain`). The only thing that differs per target is the HTTP wiring: routing, validation binding, error mapping, streaming, and the typed client story.

## Matrix

| SDK | Standalone client | Nitro client | Validation | Type-safety story |
| --- | --- | --- | --- | --- |
| `h3` | shared typed-fetch | shared typed-fetch over a built Nitro server | valibot via h3 validated readers | shared valibot types |
| `h3-dux` | honest `createClient` inferred from `typeof app` | honest `createClient` inferred from generated `#h3-dux/routes` | valibot via h3-dux route contracts | route-inferred data and typed errors |
| `hono` | `hc` RPC | `hc` RPC against the mounted Hono app | `@hono/standard-validator` | route-inferred RPC |
| `elysia` | Eden Treaty | Eden Treaty against the mounted Elysia app | valibot via Standard Schema | route-inferred, errors type-narrowed |

## API

| Feature | Endpoint |
| --- | --- |
| Liveness | `GET /health` |
| List with filter, sort, and cursor pagination | `GET /fruits?search=&tag=&minRipeness=&sort=&limit=&cursor=` |
| Read one | `GET /fruits/:id` |
| Create with validation and auth | `POST /fruits` |
| Partial update with validation and auth | `PATCH /fruits/:id` |
| Delete with auth | `DELETE /fruits/:id` |
| Checkout with out-of-stock conflict | `POST /checkout` |
| Server-Sent Events ripeness ticker | `GET /fruits/:id/ripen` |

All demos share request logging/timing, an `x-orchard-key` write guard (default `let-me-in-please`), validation errors as `422`, and the error envelope `{ "error": code, "message": string }`.

## Layout

```txt
fixtures/                         @orchard/domain
  src/schemas.ts                   valibot schemas + inferred types
  src/orchard.ts                   in-memory repository

{h3,h3-dux,hono,elysia}/
  utils/                           SDK-local helpers when only that SDK needs extra ceremony
  standalone/                      standalone runtime
    server/                        SDK-native backend package code
    client/                        typed client trip
  nitro/                           Nitro-hosted runtime
    server/                        Nitro server code
    client/                        Nitro client trip
```

## Run Trips

Run from `dux/` after `bun install`:

```bash
bun run demo:comparisons:h3:standalone
bun run demo:comparisons:h3-dux:standalone
bun run demo:comparisons:hono:standalone
bun run demo:comparisons:elysia:standalone

bun run demo:comparisons:h3:nitro
bun run demo:comparisons:h3-dux:nitro
bun run demo:comparisons:hono:nitro
bun run demo:comparisons:elysia:nitro
```

The h3 fetch client helpers live under [`h3/utils/typed-client.ts`](./h3/utils/typed-client.ts) on purpose: h3 is the only SDK here that needs that extra typed-client ceremony, so the comparison keeps that cost visible instead of hiding it in the shared Orchard domain package.

The h3 and h3-dux Nitro trips build and spawn a production Nitro server. The Hono and Elysia Nitro trips reuse the mounted app in-process because their type-safe clients are identical whether Nitro hosts the app or the app runs standalone.

## Run Servers

```bash
bun run demo:comparisons:elysia:standalone:serve  # :3001
bun run demo:comparisons:h3:standalone:serve      # :3002
bun run demo:comparisons:hono:standalone:serve    # :3003
bun run demo:comparisons:h3-dux:standalone:serve  # :3007

bun run demo:comparisons:h3:nitro:serve           # :3004
bun run demo:comparisons:hono:nitro:serve         # :3005
bun run demo:comparisons:elysia:nitro:serve       # :3006
bun run demo:comparisons:h3-dux:nitro:serve       # :3008
```
