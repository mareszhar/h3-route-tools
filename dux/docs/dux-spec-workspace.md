# h3-dux — workspace spec

The maintainer manual: how h3-dux is laid out, built, linted, tested, kept in sync with upstream, and shipped. User-facing behavior is specced in [dux-spec.md](./dux-spec.md); this documents the infrastructure that keeps it honest.

## Implementation status

| Phase | Scope | Status |
| --- | --- | --- |
| W0 | Workspace scaffold: orchestrator manifest, tooling, package skeleton, docs | ☑ done |
| W1 | Test foundations: vitest planes, selenita wiring, Orchard fixtures | ☑ done |
| W2 | Per-delta suites land with each delta (1–5) | ☑ done |
| W3 | Publishing pipeline: subtree to `mareszhar/h3-dux`, `@mszr` scope | ☑ done |
| W4 | Generation-2 test rigor: Selenita diagnostic **contracts** (delta 6) ☑ source mode; `forModes` parity + type-perf plane (100/500/1000 routes) ☐ | ◑ |
| W5 | Nitro file-route/codegen harness (delta 13): `defineFileRoute`, factory composition, and generation diagnostics are unit/type/DX-tested; the Nitro demo is migrated to file routes + generated `#h3-dux/routes` and verified through `nitro prepare` + project typecheck ☑. A standalone automated dev-regeneration (add/remove/rename) harness is ◑ pending | ◑ |

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
  docs/                   vision · language · patterns · spec · this manual
  h3-dux/                 the published package, @mszr/h3-dux
  sandbox/
    demo-main/            focused h3-dux demo, split into standalone and Nitro
    demo-comparisons/     Orchard SDK comparisons, all managed by this workspace
```

### Tooling, and why it differs from upstream

The outer repo uses **ox** (oxlint + oxfmt). Inside `dux/` we use **ESLint** (`@antfu/eslint-config`, formatters on) and the ESLint formatter — the stack the maintainer standardizes across every dux project. The two never fight because the outer ox config ignores `dux/**` ([§7](#7-changes-outside-dux)). The package build uses **obuild** (ESM-only), matching upstream, so output and externals stay diffable.

---

## 2. Sandbox Demos

`sandbox/demo-main/` is the focused h3-dux showcase. It is intentionally outside `h3-dux/` because it depends on workspace-local package links and shared maintainer context that will not exist when `dux/h3-dux` is published as a subtree to `mareszhar/h3-dux`. Its `standalone/` and `nitro/` folders keep the two runtime modes separate while sharing small local fixtures.

`sandbox/demo-comparisons/` is the Orchard comparison matrix — h3, h3-dux, Hono, and Elysia, each in standalone and Nitro form. The shared business logic and narrated trips live in `fixtures/` (`@orchard/domain`), while each SDK folder owns its HTTP wiring and typed client surface. These demos are live workspace members, so one bun install and one Turbo setup manages the package, focused demo, comparison fixtures, backends, and clients.

---

## 3. Package mechanics

`@mszr/h3-dux` is a strict superset of `h3-route-tools`.

- **Build:** obuild emits three bundle entries (`index`, `nitro`, `codegen`) to `dist/*.mjs` + `*.d.mts`. The upstream package and its node-only peers (`nitro`, `typescript`) are kept **external** (see `h3-dux/build.config.ts`), so we re-export rather than re-bundle — `dist/index.mjs` is a thin `export * from 'h3-route-tools'` plus our additions.
- **Exports:** `.`, `./nitro`, `./codegen`, all named, `sideEffects: false` for tree-shaking.
- **Upstream dependency:** `h3-route-tools` is a runtime `dependency`. For typecheck, `h3-dux/tsconfig.json` maps it to the fork source (`../../src/*`) via `paths`, so we always typecheck against *our* upstream, not whatever is on npm — the whole point of forking. obuild resolves it as an external package name at build time.
- **Peers:** `h3` is the one needed by every user → it stays a required peer. `nitro` and `srvx` are needed only by a subpath → optional peers. The rule: needed by everyone → dependency/peer; needed by a subpath → optional peer.
- **Manifest stays npm-only.** `h3-dux/package.json` carries no `scripts` — only what npm needs to describe and resolve the published artifact (name, exports, files, peer/runtime deps, the devDependencies that pull build/test tools into `h3-dux/node_modules`). The orchestrator (`dux/package.json`, [§8](#8-scripts)) is the one place that controls how the package is built, linted, tested, and published, invoking those tools directly (`cd h3-dux && bun x <tool>`) rather than through package-local scripts.

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

`vitest run --typecheck` locks all three. Tests collocate beside the code they exercise; the larger Orchard comparison schemas live in `sandbox/demo-comparisons/fixtures/`. A **parity** check pins that h3-dux's inherited behavior still matches `h3-route-tools` for the routes both express — when upstream moves, parity fails before a user does.

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
| `bun run lint` / `lint:fix` | ESLint across `dux/` |
| `bun run sdk:build:ours` | build `@mszr/h3-dux` (obuild → `dist`) |
| `bun run sdk:build:all` | build upstream `h3-route-tools`, then ours |
| `bun run sdk:typecheck` | `tsc --noEmit` for the package |
| `bun run sdk:test` / `sdk:test:watch` | Vitest (all three planes) |
| `bun run sdk:dev` | obuild stub for fast iteration |
| `bun run typecheck` / `test` / `build` | turbo across the workspace |
| `bun run validate` / `val` | lint + typecheck + test |
| `bun run demo:main:standalone` | focused h3-dux standalone demo trip |
| `bun run demo:main:nitro` | focused h3-dux Nitro demo server |
| `bun run prepublish:verify` | shared gate, standalone: build · lint · typecheck · test |
| `bun run publish:sdk:dry-run` | gate + packaging rehearsal (`npm publish --dry-run`); no bump, nothing published |
| `bun run publish:sdk:patch` / `:minor` / `:major` | the release: gate → bump → build → `npm publish` → commit + tag → subtree squash |
| `bun run publish:subtree:squash` | ad hoc: squash-push `h3-dux/` to the public repo on its own |

`@mszr/h3-dux`'s own `package.json` carries no scripts — every command above invokes the underlying tool directly (`cd h3-dux && bun x <tool>`), so the orchestrator's manifest stays the single place that controls how the package is built, linted, tested, and published. The package manifest itself holds only what npm needs to describe the published artifact: name, exports, files, peer/runtime deps.

---

## 9. Publishing

The published `mareszhar/h3-dux` repo is the package + docs face, not the development home — development stays in this fork, because typechecking against the fork's upstream source is the point. Releases push the `h3-dux/` subtree to the public repo as a single squashed commit and publish `@mszr/h3-dux` to npm under the `@mszr` scope. The pipeline lives in `dux/scripts/publish/`.

There is no demo-deploy step and no workspace-dependency pinning dance: h3-dux has no Vercel-hosted demo, and `h3-route-tools` is already a plain npm semver range in `h3-dux/package.json` rather than a `workspace:*` link — so a release's only mutation is the version bump itself.

**The flow** (`bun run publish:sdk:<patch|minor|major>`):

1. **Shared gate**, once — build · lint · typecheck · test (`scripts/publish/lib/gates.ts`). A green run leaves a content-keyed receipt (`scripts/publish/lib/verify-stamp.ts`) so an immediately-following step (or a resumed release) doesn't re-verify unchanged inputs. `H3DUX_FORCE_VERIFY=1` ignores the receipt; the deliberately awkward `H3DUX_UNSAFE_PUBLISH_SKIP_CHECKS=1` skips the gate outright — there is no flag for that, on purpose.
2. **npm auth check**, then bump `h3-dux/package.json`'s version (a direct write — `npm version` would try to reify the outer pnpm workspace and crash on it).
3. **Build, then `npm publish --access public`.** A failure up to and including this step restores the original `package.json`; nothing is recorded as released.
4. Once published, the bump is permanent. The remaining steps are guarded by an in-flight **release record** (`scripts/publish/lib/release-state.ts`, gitignored under `dux/.dux/`) so a later failure resumes from the first incomplete step instead of re-publishing or re-bumping: wait for npm registry propagation, commit `🔖 release v<version>` and tag it, then squash-push the public subtree (`scripts/publish/publish-subtree.ts`) with the same message.

`bun run publish:sdk:dry-run` rehearses the gate and packaging (`npm publish --dry-run`) without bumping or publishing anything. `bun run publish:subtree:squash` runs the squash on its own — useful for re-pushing the public mirror without cutting a new npm version; it opens `$GIT_EDITOR` on a prefilled `🔖 release v<version>` message unless `--message` is passed.

The gitmoji convention (`🔖 release vX.Y.Z`), the squash-to-public-repo model, and the resumable release-state machinery follow the same maintainer mechanics across every dux fork.
