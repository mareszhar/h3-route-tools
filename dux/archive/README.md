# 🍊 Orchard

One small fruit-market API, implemented **six ways**, each paired with a **type-safe client** — so you can compare the ergonomics and DX of **Elysia**, **h3** and **Hono**, both standalone and hosted under **Nitro**.

Every backend exposes the exact same API and reuses the exact same business logic (`@orchard/domain`). The only thing that differs per target is the **HTTP wiring** — routing, validation binding, error mapping, streaming — which is precisely what we want to compare.

## The matrix

| Target | Backend | Client | Validation | Type-safe client |
| --- | --- | --- | --- | --- |
| `elysia` | standalone (Bun) `:3001` | [Eden Treaty](https://elysiajs.com/eden/treaty/overview) | valibot via Standard Schema | route-inferred, errors type-narrowed |
| `h3` | standalone (Bun) `:3002` | shared typed-fetch | valibot via `readValidatedBody` | shared valibot types |
| `hono` | standalone (Bun) `:3003` | [`hc`](https://hono.dev/docs/guides/rpc) RPC | valibot via `@hono/standard-validator` | route-inferred |
| `nitro/h3` | **file-based routing** `:3004` | shared typed-fetch (live server) | valibot via `readValidatedBody` | shared valibot types |
| `nitro/hono` | server entry mount `:3005` | `hc` RPC | (delegated to the Hono app) | route-inferred |
| `nitro/elysia` | server entry mount `:3006` | Eden Treaty | (delegated to the Elysia app) | route-inferred |

The three **Nitro** targets reflect the [docs' claim](https://nitro.build/) that "Elysia, h3, Hono — anything that speaks web standards works with Nitro":

- **`nitro/h3`** uses Nitro's native **file-based routing** (the dir-tree showcase), since Nitro is built on h3.
- **`nitro/hono`** and **`nitro/elysia`** mount the _existing_ modular app via a catch-all route (`routes/[...].ts`) — "bring your own web-standard framework," with Nitro as the runtime/deploy layer.

## The API

| Feature | Endpoint |
| --- | --- |
| Liveness | `GET /health` |
| List — filter + sort + **cursor pagination** | `GET /fruits?search=&tag=&minRipeness=&sort=&limit=&cursor=` |
| Read one (404 if missing) | `GET /fruits/:id` |
| Create (validated, **auth**) → 201 | `POST /fruits` |
| Partial update (validated, auth, 404) | `PATCH /fruits/:id` |
| Delete (auth) → 204 | `DELETE /fruits/:id` |
| Checkout — business logic + **409 out-of-stock** | `POST /checkout` |
| **Server-Sent Events** ripeness ticker | `GET /fruits/:id/ripen` |

Every backend also shares: request **logging/timing**, an **`x-orchard-key`** guard on writes (default key `let-me-in-please`), valibot validation → **422**, and a uniform error envelope `{ "error": code, "message": string }`.

## Layout

```txt
packages/
  domain/            @orchard/domain — the ONLY place logic lives
    schemas.ts       valibot schemas + inferred types
    orchard.ts       in-memory repository (list/get/create/update/remove/checkout/ripen)
    errors.ts        domain errors → HTTP status
    client.ts        shared web-standard typed-fetch client
    trips.ts         shared narrated "shopping trip"
playground/
  backends/{elysia,h3,hono,nitro/{h3,hono,elysia}}    HTTP wiring only
  clients/{elysia,h3,hono,nitro/{h3,hono,elysia}}     consumption demos
```

## Quickstart

```bash
bun install
```

**Run a client demo** — each spins up its server (in-process, or a real Nitro build for `nitro/h3`), runs a narrated trip across every endpoint (including deliberate 401/404/409), and exits:

```bash
bun --cwd=playground/clients/elysia run dev
bun --cwd=playground/clients/hono run dev
bun --cwd=playground/clients/h3 run dev
bun --cwd=playground/clients/nitro/h3 run dev      # builds + spawns a real Nitro server
bun --cwd=playground/clients/nitro/hono run dev
bun --cwd=playground/clients/nitro/elysia run dev
```

> `bun --filter '<pkg>' dev` also works, but its live status box truncates long logs by default (`[N lines elided]`) and — in an interactive terminal — its in-place redraw can't always reposition the cursor once output exceeds the visible region, so each repaint gets flushed as new scrollback instead of overwriting the last one. That can look like the trip restarting from `GET /health` several times; it isn't — only the **last**, complete frame is the real run. Running with `--cwd=<path>` (as above) sidesteps the live box and just streams the trip once, cleanly. Note the `=` is required — `--cwd <path> run dev` (space-separated) gets misparsed and prints `bun run`'s help instead of running the script.

**Run a backend** and poke it by hand (see [`requests.http`](./requests.http) or use `curl`/[HTTPie](https://httpie.io)):

```bash
bun --cwd=playground/backends/elysia run dev       # :3001
bun --cwd=playground/backends/h3 run dev           # :3002
bun --cwd=playground/backends/hono run dev         # :3003
bun --cwd=playground/backends/nitro/h3 run dev     # :3004
bun --cwd=playground/backends/nitro/hono run dev   # :3005
bun --cwd=playground/backends/nitro/elysia run dev # :3006
```

```bash
http :3001/fruits sort==price limit==2
http POST :3001/fruits x-orchard-key:let-me-in-please \
  name=Mango emoji=🥭 color=orange tags:='["sweet"]' pricePerKg:=5 stockKg:=12
curl -N :3001/fruits/kiwi/ripen           # watch the SSE stream
```

## Scripts (root)

| Script | Does |
| --- | --- |
| `bun run dev` | `turbo run dev` across packages |
| `bun run build` | build (Nitro targets) |
| `bun run lint` / `lint:fix` | ESLint (antfu) |
| `bun run typecheck` | `tsc` per package (Nitro runs `nitro prepare` first) |
| `bun run validate` / `val` | lint + typecheck + test |
| `bun run upi` | interactive dependency updates |

## Tooling notes

- **Bun workspaces + Turborepo**, TypeScript throughout, **valibot** as the validator.
- **ESLint** with [`@antfu/eslint-config`](https://github.com/antfu/eslint-config) (formatters on); see [`.vscode/settings.json`](./.vscode/settings.json) for fix-on-save.
- **Bleeding edge**: Nitro v3 (beta) + h3 v2 + Elysia 1.4 + Hono 4.12 — the web-standard direction powering Nuxt 5.
- [`bunfig.toml`](./bunfig.toml) pins the **hoisted** linker so Nitro's Node-based dev worker can resolve its dependencies.
- The `nitro/h3` demo throws domain errors that, in `nitro dev` only, can trip the dev error overlay; its **production** server (`bun --cwd=playground/backends/nitro/h3 run start`, after `build`) renders every error cleanly, which is what its client drives.
