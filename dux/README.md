# dux — maintainer workspace

This is the dux maintainer area inside the **h3-route-tools** fork.

**dux** (`@mszr/h3-dux`) is a DX/UX-first reimagining of [`h3-route-tools`](https://github.com/sandros94/h3-route-tools).
It keeps h3 and Nitro exactly as they are, inherits the upstream library's engine — the accumulating typed route
builder, Standard Schema validation, the fetchdts-style client, Nitro codegen, OpenAPI — and rebuilds the
authoring surface around one question: *what would feel most delightful to use?*

## Repo context

- This repository is a fork of [`sandros94/h3-route-tools`](https://github.com/sandros94/h3-route-tools).
- `main` mirrors upstream untouched; we develop on the `dux` branch.
- All our work lives under this folder, `dux/`. The upstream sources outside it stay as-is, so rebasing and
  mirroring upstream changes stays trivial.

## What's here

- `h3-dux/` — the publishable package, `@mszr/h3-dux`
- `docs/` — the vision, conventions, spec, and maintainer manual that drive it
- `archive/` — the Orchard reference (six backends, frozen) showing the unsafe status quo we improve on
- `scripts/` — maintainer automation

## Start here

- **The hub:** [`docs/dux-vision.md`](./docs/dux-vision.md) — what h3-dux is, why a fork, the principles, the roadmap
- Cross-cutting law: [`docs/dux-conventions.md`](./docs/dux-conventions.md)
- The deltas, contract by contract: [`docs/dux-spec.md`](./docs/dux-spec.md)
- Maintainer manual: [`docs/dux-spec-workspace.md`](./docs/dux-spec-workspace.md)
- Package front door: [`h3-dux/README.md`](./h3-dux/README.md)

## Top commands

Run from `dux/` (bun + turbo):

1. `bun install` — resolve the workspace and install git hooks
2. `bun run sdk:build:ours` — build `@mszr/h3-dux` (obuild → `dist`)
3. `bun run sdk:typecheck` — typecheck the package against the fork's upstream source
4. `bun run sdk:test` — every assertion plane (runtime, types, editor DX)
5. `bun run lint` / `lint:fix` — ESLint across `dux/`
