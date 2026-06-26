# h3-dux — workspace spec

The maintainer manual: how h3-dux is laid out, built, linted, tested, kept in sync with upstream, and shipped. User-facing behavior is specced in [dux-spec.md](./dux-spec.md); this documents the infrastructure that keeps it honest.

## Implementation status

| Phase | Scope | Status |
| --- | --- | --- |
| W0 | Workspace scaffold: orchestrator manifest, tooling, package skeleton, docs | ☑ done |
| W1 | Test foundations: vitest planes, selenita wiring, Orchard fixtures | ☐ |
| W2 | Per-delta suites land with each delta (1–5) | ☐ |
| W3 | Publishing pipeline: subtree to `mareszhar/h3-dux`, `@mszr` scope | ☐ |
| W4 | Generation-2 test rigor: Selenita diagnostic **contracts** (delta 6) ☑ source mode; `forModes` parity + type-perf plane (100/500/1000 routes) ☐ | ◑ |
| W5 | Nitro file-route/codegen harness (delta 13): `defineFileRoute`, factory composition, and generation diagnostics are unit/type/DX-tested; the Nitro demo is migrated to file routes + generated `#h3-dux/routes` and verified through `nitro prepare` + project typecheck ☑. A standalone automated dev-regeneration (add/remove/rename) harness is ◑ pending | ◑ |

---

## 1. Layout

`dux/` is a self-contained **orchestrator workspace** — bun + turbo — that owns everything we maintain. It is not part of the outer `h3-route-tools` pnpm workspace; the outer repo never reaches in, and we change files outside `dux/` only when unavoidable ([§7](#7-changes-outside-dux)).

```
dux/
  package.json            orchestrator manifest (h3-dux-workspace); workspaces: ["h3-dux"]
  turbo.json              dev / build / typecheck / test pipelines
  tsconfig.base.json      shared compiler options (members extend this)
  bunfig.toml             hoisted linker (Node tools resolve transitive deps)
  eslint.config.ts        @antfu flat config with formatters — the single lint authority for dux/
  .markdownlint.json      markdown rules for the editor extension
  .vscode/                eslint fix-on-save, no Prettier; eslint + Volar recommended
  .githooks/pre-commit    lint guard for staged dux changes
  scripts/                maintainer scripts (git-hook install, …)
  docs/                   vision · conventions · spec · this manual
  h3-dux/                 the published package, @mszr/h3-dux
  archive/                the Orchard reference (frozen; see §2)
```

### Tooling, and why it differs from upstream

The outer repo uses **ox** (oxlint + oxfmt). Inside `dux/` we use **ESLint** (`@antfu/eslint-config`, formatters on) and the ESLint formatter — the stack the maintainer standardizes across every dux project. The two never fight because the outer ox config ignores `dux/**` ([§7](#7-changes-outside-dux)). The package build uses **obuild** (ESM-only), matching upstream, so output and externals stay diffable.

---

## 2. The archive

`archive/` is the Orchard reference — one fruit-market API across six backends (h3, Hono, Elysia, each also under Nitro) and their clients. It exists to show *what we used to have to do* and how unsafe the hand-typed h3 client was. It is the source of the concrete schemas the spec snippets use, and the future home of test fixtures.

It is a **frozen reference, not a live build target.** Its own toolchain config was hoisted up to `dux/` (so the config lives in one place), and every member `tsconfig` was repointed to the hoisted `tsconfig.base.json`. It is *not* listed in the workspace `workspaces`, so `bun install` stays lean and we never build six bleeding-edge backends to work on the package, and it is **excluded from our ESLint** (`archive/**`) so its original formatting is preserved rather than churned into our house style. Re-wiring it into turbo and lint later is a one-line change (add its globs back, drop the ignore) — the seams are intact.

---

## 3. Package mechanics

`@mszr/h3-dux` is a strict superset of `h3-route-tools`.

- **Build:** obuild emits three bundle entries (`index`, `nitro`, `codegen`) to `dist/*.mjs` + `*.d.mts`. The upstream package and its node-only peers (`nitro`, `typescript`) are kept **external** (see `h3-dux/build.config.ts`), so we re-export rather than re-bundle — `dist/index.mjs` is a thin `export * from 'h3-route-tools'` plus our additions.
- **Exports:** `.`, `./nitro`, `./codegen`, all named, `sideEffects: false` for tree-shaking.
- **Upstream dependency:** `h3-route-tools` is a runtime `dependency`. For typecheck, `h3-dux/tsconfig.json` maps it to the fork source (`../../src/*`) via `paths`, so we always typecheck against *our* upstream, not whatever is on npm — the whole point of forking. obuild resolves it as an external package name at build time.
- **Peers:** `h3` is the one needed by every user → it stays a required peer. `nitro` and `srvx` are needed only by a subpath → optional peers. The rule: needed by everyone → dependency/peer; needed by a subpath → optional peer.

---

## 4. Boundaries

Three planes — **server**, **client**, **nitro** — plus the schema/validation helpers they share. The law (principle 7): the client plane never imports the nitro plane, and neither imports node-only internals the other doesn't need. Today the package is mostly re-exports, so the boundary is thin; as the deltas land, each plane gets its own module and the boundary becomes ESLint `no-restricted-imports` rules in `eslint.config.ts`. A boundary violation is a build error, not a review note.

The **contract kernel** (`internal/contract.ts`, delta 7) is the one *type* module every plane is allowed to import — it is the single source of truth all typed planes derive from, and it carries no runtime, no node-only deps, no plane allegiance. Server, client, and codegen read the kernel; OpenAPI follows its status/error/kind rules while reading runtime route schemas for JSON Schema emission. Planes do not read each other. Keeping the cross-plane dependency funnelled through the kernel plus explicit runtime route metadata is what lets a projection fix land everywhere without widening the boundary.

---

## 5. Testing

One runner (Vitest), three assertion planes, one fixture set. No delta is "done" until its editor-DX plane is green — a silently-dead completion is invisible to the other two.

| Plane | Suffix | Asserts | Tool |
| --- | --- | --- | --- |
| Runtime | `*.test.ts` | routing, validation, SSE streaming, error envelopes, `{ data, error }` / `.orThrow()` / `.raw()` | Vitest |
| Type shapes | `*.test-d.ts` | inferred response types, the accumulated `typeof app`, client narrowing, typed `error` discrimination, merged context | Vitest `--typecheck` |
| Editor DX | `*.dx.test.ts` | completions and diagnostics land on the intended cursor with the intended message | [selenita](https://github.com/mareszhar/selenita) on Vitest |

`vitest run --typecheck` locks all three. Tests collocate beside the code they exercise; the Orchard schemas in `archive/` are the shared fixture. A **parity** check pins that h3-dux's inherited behavior still matches `h3-route-tools` for the routes both express — when upstream moves, parity fails before a user does.

### Diagnostics are a contract, not an accident (Generation 2)

The editor-DX plane is the bar that the rest of the field doesn't test (delta 6) — so it is promoted from "an error exists" to a **quality contract**. `expect(errors).toHaveError(/not assignable/)` proves a failure fires, not that it helps; the contract asserts the message a human reads:

- **exactly one** diagnostic (not the doubled "Overload 1 of 2 … 2 of 2");
- it **names the offending field** (`stockKg`);
- it says **missing / required**;
- it **lands on** the `body` literal, not the call;
- the hover stays a **readable public type** (no `ObjectSchema<…>` wall);
- it holds **across `forModes`** (source and built `.d.mts` behave alike, via Selenita's mode matrix);
- `toHaveCompletionParity` pins completions between modes.

Because every Generation-2 delta adds generic complexity, the diagnostic contract is also a **regression gate**: a kernel or composition change that re-leaks schema internals fails here before it reaches an editor. A new **type-performance** plane sanity-checks editor responsiveness at 100 / 500 / 1000 routes, so the kernel's flattening keeps large apps fast (Hono's RPC types have documented IDE-scaling costs; this is where we prove we don't inherit them).

### Nitro codegen harness (phase W5)

Phase 9 adds a real Nitro fixture rather than testing generated strings in isolation. The harness runs `nitro prepare`, typechecks the generated project, and exercises dev regeneration. It covers:

- method-locked flat handlers and unsuffixed shared/method-map handlers;
- validation modes, typed errors, every response kind, SSE, and route-local bindings;
- file-route factory `.use()`/`.requires()`/`.compose()` capability flow;
- generated exact client params for nested, optional, and catch-all filesystem segments;
- explicit params-schema agreement with the normalized path;
- duplicate path+method, method-lock mismatch, unresolved requirements, binding collisions, and invalid body-bearing shared handlers;
- add, remove, and rename regeneration without restarting from a clean build;
- `#h3-dux/routes` source/built declaration parity and leak guards (no schema implementation types);
- graceful coexistence with plain Nitro and inherited upstream handlers, which remain valid but are omitted from the h3-dux client map.

Nuxt integration is not a W5 target. It begins only after Nuxt 5 publishes a stable h3 v2/Nitro v3 module and type-generation contract.

---

## 6. Staying in sync (the fork-rebase ritual)

`main` mirrors `h3-route-tools` untouched; we work on `dux`. On each upstream sync:

1. Rebase `dux` onto the updated `main` (or merge upstream into `main`, then rebase). Because our edits live under `dux/`, conflicts are rare and localized.
2. Run `bun run sdk:typecheck` — upstream API changes break our re-export and `paths`-resolved wrap points loudly.
3. Run the full suite (`bun run sdk:test`), including parity — behavioral drift surfaces here.
4. Re-apply only our delta where a wrap point moved; the contract in [dux-spec.md](./dux-spec.md) is the guide.

Generalizable deltas (SSE, verb sugar, validation modes) are proposed upstream on a separate branch. If they land, the corresponding delta here shrinks to a re-export.

---

## 7. Changes outside dux

The few edits we made outside `dux/`, each minimal and reversible, so the fork stays green:

- **`.oxlintrc.json` / `.oxfmtrc.json`** — ignore `dux/**`. The outer `ci.yml` runs `pnpm lint` (ox) on every branch including `dux`; without this, ox and our ESLint would fight over `dux/` files.
- **`.github/workflows/autofix.ci.yaml`** — `paths-ignore: ['dux/**']`, so the auto-formatter never rewrites our ESLint-managed files.
- **`.gitignore`** — add `.turbo`.
- **`.github/workflows/dux.yml`** (additive) — lint + typecheck `dux/` on the `dux` branch with bun.
- **`h3-dux.code-workspace`** (additive, repo root) — opens `dux/` as its own VS Code folder, excluded from the root view.

We do **not** touch upstream `src/`, `test/`, `playgrounds/`, the root `package.json`, or `pnpm-workspace.yaml` (`dux/` already falls outside its globs).

> **Git hooks.** `scripts/install-git-hooks.ts` (run by `bun install`'s postinstall) points `core.hooksPath → dux/.githooks`. On the `dux` branch this supersedes the outer `simple-git-hooks`; the dux hook lints staged `dux/` changes and no-ops for commits that don't touch `dux/`. That trade is deliberate — the `dux` branch is our working branch, where our lint rules apply.

---

## 8. Scripts

Run from `dux/`.

| Command | Does |
| --- | --- |
| `bun run lint` / `lint:fix` | ESLint across `dux/` (incl. archive source and markdown) |
| `bun run sdk:build:ours` | build `@mszr/h3-dux` (obuild → `dist`) |
| `bun run sdk:build:all` | build upstream `h3-route-tools`, then ours |
| `bun run sdk:typecheck` | `tsc --noEmit` for the package |
| `bun run sdk:test` / `sdk:test:watch` | Vitest (all three planes) |
| `bun run sdk:dev` | obuild stub for fast iteration |
| `bun run typecheck` / `test` / `build` | turbo across the workspace |
| `bun run validate` / `val` | lint + typecheck + test |

---

## 9. Publishing

The published `mareszhar/h3-dux` repo is the package + docs face, not the development home — development stays in this fork, because typechecking against the fork's upstream source is the point. Releases push the `h3-dux/` subtree to the public repo and publish `@mszr/h3-dux` to npm under the `@mszr` scope. The pipeline (phase W3) will follow the idb-dux model: a single verification gate (build · lint · typecheck · test · parity), then version bump, npm publish, and subtree push.
