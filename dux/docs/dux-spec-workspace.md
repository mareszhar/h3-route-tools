# h3-dux — workspace spec

The maintainer manual: how h3-dux is laid out, built, linted, tested, kept aligned with the h3 ecosystem, and shipped. User-facing behavior is specced in [dux-spec-sdk.md](./dux-spec-sdk.md); this documents the infrastructure that keeps it honest.

## Implementation status

| Phase | Scope | Status |
| --- | --- | --- |
| W0 | Workspace scaffold: orchestrator manifest, tooling, package skeleton, docs | ☑ done |
| W1 | Test foundations: vitest planes, selenita wiring, Orchard fixtures | ☑ done |
| W2 | Per-delta suites land with each delta (1–5) | ☑ done |
| W3 | Publishing pipeline: subtree to `mareszhar/h3-dux`, `@mszr` scope | ☑ done |
| W4 | Generation-2 test rigor: Selenita diagnostic **contracts** (delta 6) in source mode, including leak guards for diagnostics, completions, hovers, and return types. Built-declaration parity and a 100/500/1000 route type-performance plane are tracked as post-publish hardening. | ☑ publish gate done |
| W5 | Nitro file-route/codegen harness (delta 13): `defineFileRoute`, factory composition, and generation diagnostics are unit/type/DX-tested; the Nitro demo is migrated to file routes + generated `#h3-dux/routes` and verified through `nitro prepare` + project typecheck. Automated add/remove/rename dev-regeneration remains post-publish hardening. | ☑ publish gate done |

---

## 1. Layout

`dux/` is a self-contained **orchestrator workspace** — bun + turbo — that owns everything we maintain. It is not part of the outer `h3-route-tools` pnpm workspace; the outer repo never reaches in, and we change files outside `dux/` only when unavoidable ([§7](#7-changes-outside-dux)).

```
dux/
  package.json            orchestrator manifest (h3-dux-workspace); package + sandbox workspaces
  turbo.json              dev / build / typecheck / test pipelines
  tsconfig.base.json      shared compiler options (members extend this)
  bunfig.toml             hoisted linker (Node tools resolve transitive deps)
  eslint.config.ts        @antfu flat config with formatters — the single lint authority for dux/
  .markdownlint.json      markdown rules for the editor extension
  .vscode/                eslint fix-on-save, no Prettier; eslint + Volar recommended
  .githooks/pre-commit    lint guard for staged dux changes
  .gitignore              ignores `.dux/` (release-machinery scratch state)
  scripts/                maintainer scripts (git-hook install, publishing, …)
    publish/              prepublish gate, npm release, subtree squash ([§9](#9-publishing))
  docs/                   vision · language · patterns · sdk spec · this manual
  h3-dux/                 the published package, @mszr/h3-dux
  sandbox/
    demo-main/            focused h3-dux demo, split into standalone and Nitro
    demo-comparisons/     Orchard SDK comparisons, all managed by this workspace
```

### Tooling, and why it differs from the outer repo

The outer repo uses **ox** (oxlint + oxfmt). Inside `dux/` we use **ESLint** (`@antfu/eslint-config`, formatters on) and the ESLint formatter — the stack the maintainer standardizes across every dux project. The two never fight because the outer ox config ignores `dux/**` ([§7](#7-changes-outside-dux)). The package build uses **obuild** (ESM-only), with externals limited to actual peers and build-time tools.

---

## 2. Sandbox Demos

`sandbox/demo-main/` is the focused h3-dux showcase. It is intentionally outside `h3-dux/` because it depends on workspace-local package links and shared maintainer context that will not exist when `dux/h3-dux` is published as a subtree to `mareszhar/h3-dux`. Its `standalone/` and `nitro/` folders keep the two runtime modes separate while sharing small local fixtures.

`sandbox/demo-comparisons/` is the Orchard comparison matrix — h3, h3-dux, Hono, and Elysia, each in standalone and Nitro form. The shared business logic and narrated trips live in `fixtures/` (`@orchard/domain`), while each SDK folder owns its HTTP wiring and typed client surface. These demos are live workspace members, so one bun install and one Turbo setup manages the package, focused demo, comparison fixtures, backends, and clients.

---

## 3. Package mechanics

`@mszr/h3-dux` is an independent h3 route kit.

- **Build:** obuild emits four bundle entries (`index`, `client`, `nitro`, `codegen`) to `dist/*.mjs` + `*.d.mts`. `h3` stays external as the required peer; `nitro` and `typescript` stay external in the subpaths that need them.
- **Exports:** `.`, `./client`, `./nitro`, `./codegen`, all named, `sideEffects: false` for tree-shaking. `./client` is the h3-value-free client plane (vision §4.1), so a consumer on a different h3 line can bundle it.
- **Owned baseline:** route definition, validation, typed fetch, Nitro route typing, and OpenAPI helpers live in `h3-dux/src/`. The outer `src/` tree is reference material, not a package dependency.
- **Peers:** `h3` is the one needed by every user → it stays a required peer. `nitro` is needed only by `/nitro` → optional peer. `typescript` is needed only by `/codegen` route flattening → optional peer. The rule: needed by everyone → required peer; needed by a subpath → optional peer.
- **Manifest stays npm-only.** `h3-dux/package.json` carries no `scripts` — only what npm needs to describe and resolve the published artifact (name, exports, files, peer/runtime deps, the devDependencies that pull build/test tools into `h3-dux/node_modules`). The orchestrator (`dux/package.json`, [§8](#8-scripts)) is the one place that controls how the package is built, linted, tested, and published, invoking those tools directly (`cd h3-dux && bun x <tool>`) rather than through package-local scripts.

---

## 4. Boundaries

Three planes — **server**, **client**, **nitro** — plus the schema/validation helpers they share. The law (principle 7): the client plane never imports the nitro plane, and neither imports node-only internals the other doesn't need. Each plane owns a module boundary; the next hardening step is ESLint `no-restricted-imports` rules in `eslint.config.ts`. A boundary violation is a build error, not a review note.

The **contract kernel** (`internal/contract.ts`, delta 7) is the one *type* module every plane is allowed to import — it is the single source of truth all typed planes derive from, and it carries no runtime, no node-only deps, no plane allegiance. Server, client, and codegen read the kernel; OpenAPI follows its status/error/kind rules while reading runtime route schemas for JSON Schema emission. Planes do not read each other. Keeping the cross-plane dependency funnelled through the kernel plus explicit runtime route metadata is what lets a projection fix land everywhere without widening the boundary.

---

## 5. Testing

One runner (Vitest), three assertion planes, one fixture set. No delta is "done" until its editor-DX plane is green — a silently-dead completion is invisible to the other two.

| Plane | Suffix | Asserts | Tool |
| --- | --- | --- | --- |
| Runtime | `*.test.ts` | routing, validation, SSE streaming, error envelopes, `{ data, error }` / `.orThrow()` / `.raw()` | Vitest |
| Type shapes | `*.test-d.ts` | inferred response types, the accumulated `typeof app`, client narrowing, typed `error` discrimination, merged context | Vitest `--typecheck` |
| Editor DX | `*.dx.test.ts` | completions and diagnostics land on the intended cursor with the intended message | [selenita](https://github.com/mareszhar/selenita) on Vitest |

`vitest run --typecheck` locks all three. Tests collocate beside the code they exercise; the larger Orchard comparison schemas live in `sandbox/demo-comparisons/fixtures/`. Reference comparisons belong in sandbox demos and review, not as a runtime package contract.

### The editor-DX plane locks the message, not just the error

`expect(errors).toHaveError(/not assignable/)` proves a failure fires, not that it helps. The DX plane asserts the *message a human reads* — the exact diagnostic, the named field, the leak-free hover — so each delta's diagnostic guarantees are a contract, specced with the delta (e.g. [dux-spec-sdk.md §6](./dux-spec-sdk.md#6-cleaner-inference--diagnostics-as-contract)) rather than restated here. Because every Generation-2 delta adds generic complexity, that plane doubles as a **regression gate**: a kernel or composition change that re-leaks schema internals fails here before it reaches an editor.

Two hardening planes stay intentionally tracked after the publish gate: Selenita source-vs-built declaration parity, and type-performance checks at 100 / 500 / 1000 routes. They are valuable, but they are not allowed to make the current docs imply unverified behavior is already part of the release gate.

### Nitro codegen harness (phase W5)

The Nitro tests run a real Nitro fixture, not string assertions over generated code: `nitro prepare`, then a typecheck of the generated project. This exercises the full delta-13 surface end-to-end through the actual codegen ([dux-spec-sdk.md §13](./dux-spec-sdk.md#13-nitro-deltas-via-codegen)) — every handler shape, the standalone behaviors carried into file routes, factory capability flow, generated client params, and the generation diagnostics. Three things only a live harness can check: add/remove/rename **dev-regeneration** without a clean rebuild, `#h3-dux/routes` **source/built declaration parity** with leak guards, and **coexistence** with plain Nitro and owned baseline handlers (untyped routes stay out of the h3-dux client map).

Nuxt integration is not a W5 target. It begins only after Nuxt 5 publishes a stable h3 v2/Nitro v3 module and type-generation contract.

---

## 6. Staying Aligned

The outer reference can track h3-route-tools or other h3 ecosystem proposals, but `dux/h3-dux` is the owned implementation. On each reference sync:

1. Review the reference diff for fixes, conventions, or h3/Nitro compatibility changes worth porting.
2. Port the idea into the owned h3-dux module that owns the concept; do not add a package dependency to recover old behavior.
3. Run `bun run sdk:typecheck` and the full suite (`bun run sdk:test`).
4. Update the contract docs when the port changes h3-dux behavior.

Generalizable ideas can still be proposed back to the h3 ecosystem, but h3-dux does not wait on that process to improve.

### Upstream watch (recheck on h3/Nitro bumps)

Known upstream conditions h3-dux works *around* rather than owns. Each has a **trigger** to re-test on the next h3/Nitro bump; when a trigger clears, delete the row and simplify the workaround it justifies.

| # | Condition | Impact on dux | Workaround in dux | Recheck trigger |
| - | --- | --- | --- | --- |
| U1 | **Two h3 copies under Nitro.** `nitro@3.0.0` pins `h3` to *exactly* `2.0.1-rc.2`; h3-dux's peer floor is `>=2.0.1-rc.22`. An exact pin below the floor can't dedupe, so a Nitro+dux install runs two h3 builds side by side, and an event built by one can be shape-incompatible with a helper from the other (e.g. `handleCors` → `event.res.errHeaders` missing → 500). | Programmatic-app mounts that used `app.native.handler(event)` crashed on h3 helpers. | `toNitroHandler(app)` re-enters via dux's own h3 (`app.native.request(event.req, undefined, event.context)`), forwarding context — correct under one *or* two copies, so it needs no version alignment. Kept regardless of U1's status: it is the honest boundary. | **Condition narrowed (verified 2026-07-24, `pnpm install`).** No stable `nitro@3.0.1` exists (only `3.0.0` on the stable tag); npm's "use 3.0.1" nudge points at nothing published. But `nitro@latest` (`3.0.260610-beta`) pins `h3@2.0.1-rc.22`, and a `nitro-beta + @mszr/h3-dux` install **dedupes to a single `rc.22`** — no direct `h3` pin or override needed — because `rc.22` satisfies both Nitro's exact pin and dux's `>=rc.22` floor. So the dual-copy is confined to consumers on `nitro@3.0.0`; it dissolves on a single Nitro bump to the current beta (which per U2/U3 also clears those). Recheck when a *stable* Nitro ships pinning `h3 ≥ rc.22`; at that point the *hazard* is gone for anyone on that stable line, though `toNitroHandler` stays as the honest boundary. |
| U2 | **Nitro cloudflare-dev `plugin.dev` path.** `preset: 'cloudflare-module'` on `nitro@3.0.0` fails to resolve `…/runtime/plugin.dev` (real path moved under `dist/presets/cloudflare/runtime/`). | None on dux — a Nitro dev-only bug. | None needed in dux; consumers patch it in `nitro.config.ts` until a Nitro release ships the fix (present in betas). | Drop when the consuming project's Nitro no longer needs the config patch. |
| U3 | **Bare `unstorage` import in the Nitro dev bundle.** `.nitro/dev/index.mjs` imports bare `unstorage`, which pnpm doesn't hoist; dev 500s until `unstorage` is a direct dep. Reproduces on the node preset too. | None on dux — Nitro-dev + pnpm hoisting. | None needed in dux. | Drop when a Nitro release stops emitting the un-hoistable import. |

The pin/peer facts and the original runtime repro that established U1–U3 came from a downstream Nitro monorepo; the two dux-relevant behaviors (U1's crash and the false-positive inspect warning) are locked by `nitro-handler.test.ts` and `nitro-inspect.test.ts`.

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
| `bun run lint` / `lint:fix` | ESLint across `dux/` |
| `bun run sdk:build:ours` | build `@mszr/h3-dux` (obuild → `dist`) |
| `bun run sdk:build:all` | build the reference package, then ours |
| `bun run sdk:typecheck` | `tsc --noEmit` for the package |
| `bun run sdk:test` / `sdk:test:watch` | Vitest (all three planes) |
| `bun run sdk:dev` | obuild stub for fast iteration |
| `bun run demo:all:list` | list sandbox packages discovered from the workspace manifest |
| `bun run demo:all:upi` | run interactive dependency updates across sandbox package manifests |
| `bun run demo:all:refresh` / `demo:all:install` | refresh the workspace install after package-manifest changes |
| `bun run demo:all:prep` / `typecheck` / `build` | run that script across sandbox packages that define it, skipping the rest |
| `bun run typecheck` / `test` / `build` | turbo across the workspace |
| `bun run validate` / `val` | lint + typecheck + test |
| `bun run demo:main:standalone` | focused h3-dux standalone demo trip |
| `bun run demo:main:nitro` | focused h3-dux Nitro demo server |
| `bun run prepublish:verify` | shared gate, standalone: build · lint · typecheck · test |
| `bun run publish:sdk:dry-run` | gate + package-tarball rehearsal (`npm pack --dry-run`); no bump, nothing published |
| `bun run publish:sdk:patch` / `:minor` / `:major` | the release: gate → bump → build → `npm publish` → commit + tag → subtree squash |
| `bun run publish:subtree:squash` | ad hoc: squash-push `h3-dux/` to the public repo on its own |

`@mszr/h3-dux`'s own `package.json` carries no scripts — every command above invokes the underlying tool directly (`cd h3-dux && bun x <tool>`), so the orchestrator's manifest stays the single place that controls how the package is built, linted, tested, and published. The package manifest itself holds only what npm needs to describe the published artifact: name, exports, files, peer/runtime deps.

---

## 9. Publishing

The published `mareszhar/h3-dux` repo is the package + docs face, not the development home — development stays in this fork so the reference context and sandbox comparisons remain nearby. Releases push the `h3-dux/` subtree to the public repo as a single squashed commit and publish `@mszr/h3-dux` to npm under the `@mszr` scope. The pipeline lives in `dux/scripts/publish/`.

There is no demo-deploy step and no workspace-dependency pinning dance: h3-dux has no Vercel-hosted demo and no runtime dependency on the reference package, so a release's only manifest mutation is the version bump itself.

**The flow** (`bun run publish:sdk:<patch|minor|major>`):

1. **Shared gate**, once — build · lint · typecheck · test (`scripts/publish/lib/gates.ts`). A green run leaves a content-keyed receipt (`scripts/publish/lib/verify-stamp.ts`) so an immediately-following step (or a resumed release) doesn't re-verify unchanged inputs. `H3DUX_FORCE_VERIFY=1` ignores the receipt; the deliberately awkward `H3DUX_UNSAFE_PUBLISH_SKIP_CHECKS=1` skips the gate outright — there is no flag for that, on purpose.
2. **npm auth check**, then bump `h3-dux/package.json`'s version (a direct write — `npm version` would try to reify the outer pnpm workspace and crash on it).
3. **Build, then `npm publish --access public`.** A failure up to and including this step restores the original `package.json`; nothing is recorded as released.
4. Once published, the bump is permanent. The remaining steps are guarded by an in-flight **release record** (`scripts/publish/lib/release-state.ts`, gitignored under `dux/.dux/`) so a later failure resumes from the first incomplete step instead of re-publishing or re-bumping: wait for npm registry propagation, commit `🔖 release v<version>` and tag it, then squash-push the public subtree (`scripts/publish/publish-subtree.ts`) with the same message.

`bun run publish:sdk:dry-run` rehearses the gate and package tarball (`npm pack --dry-run`) without bumping or publishing anything, so it stays repeatable even when the current version is already on npm. `bun run publish:subtree:squash` runs the squash on its own — useful for re-pushing the public mirror without cutting a new npm version; it opens `$GIT_EDITOR` on a prefilled `🔖 release v<version>` message unless `--message` is passed.

The gitmoji convention (`🔖 release vX.Y.Z`), the squash-to-public-repo model, and the resumable release-state machinery follow the same maintainer mechanics across every dux fork.
