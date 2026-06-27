#!/usr/bin/env bun
import type { ReleaseState } from './lib/release-state.ts'
/**
 * Publish `@mszr/h3-dux` to npm and orchestrate the release
 * (dux-spec-workspace.md §9) — the happy path:
 *
 *   bun run publish:sdk:patch | publish:sdk:minor | publish:sdk:major
 *   bun run publish:sdk:dry-run        # verify + packaging rehearsal, no publish
 *
 * Flow for a real release:
 *   1. prepublish:verify     shared gates, once
 *   2. npm auth check
 *   3. bump @mszr/h3-dux's own version (persists)
 *   4. build; npm publish --access public
 *   5. wait until npm view @mszr/h3-dux@<version> resolves
 *   6. commit "🔖 release v<version>" and tag
 *   7. squash-push the public subtree with "🔖 release v<version>"
 *
 * h3-dux has no demo-deploy step, no runtime dependency on the reference
 * package, and no workspace-dependency pinning dance. The only manifest
 * mutation a release makes is the version bump itself.
 *
 * Verification runs ONCE (step 1) and leaves a content-keyed receipt, so the
 * subtree step it drives — and any later resume — don't re-verify unchanged
 * inputs.
 *
 * Any failure up to and including publish restores the original package.json
 * and leaves no release state. Once published the bump is permanent, so the
 * release is recorded; a later step failing keeps that record and the
 * maintainer simply re-runs the same `publish:sdk:<type>` — the orchestrator
 * resumes from the first incomplete post-publish step instead of re-bumping
 * or re-doing work.
 */
import fs from 'node:fs'
import process from 'node:process'
import { runPrepublishGates } from './lib/gates.ts'
import { checkVersionOnNpm, isLoggedIn, npmEnv } from './lib/npm.ts'
import { PKG_DIR, PKG_JSON, PKG_NAME, WORKSPACE_ROOT } from './lib/paths.ts'
import { clearReleaseState, loadReleaseState, saveReleaseState } from './lib/release-state.ts'
import { capture, createLogger, run, sleep } from './lib/shell.ts'
import { publishSubtree } from './publish-subtree.ts'

const log = createLogger('sdk')

const VALID_TYPES = new Set(['patch', 'minor', 'major'])

/** Bump a clean `x.y.z` version by release type — a direct write, no npm CLI. */
function bumpVersion(current: string, type: string): string {
  const core = current.split('-')[0].split('+')[0]
  const parts = core.split('.').map(n => Number.parseInt(n, 10))
  if (parts.length !== 3 || parts.some(Number.isNaN))
    throw new Error(`cannot bump non-semver version "${current}"`)
  const [major, minor, patch] = parts
  if (type === 'major')
    return `${major + 1}.0.0`
  if (type === 'minor')
    return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/**
 * Poll npm until the just-published version resolves (registry propagation).
 * `preferOnline` is essential here: each poll must revalidate, or npm serves a
 * packument cached by the first poll (taken before propagation) and the wait
 * times out against its own stale cache.
 */
function waitForNpm(version: string, { timeoutMs = 300_000, intervalMs = 5_000 } = {}): void {
  const deadline = Date.now() + timeoutMs
  log.log(`waiting for ${PKG_NAME}@${version} to resolve on npm…`)
  let lastOutput = ''
  while (Date.now() < deadline) {
    const check = checkVersionOnNpm(PKG_NAME, version, { preferOnline: true })
    if (check.found) {
      log.log(`${PKG_NAME}@${version} is live on npm.`)
      return
    }
    lastOutput = check.output
    sleep(intervalMs)
  }
  log.fail([
    `${PKG_NAME}@${version} did not appear on npm within ${timeoutMs / 1000}s.`,
    lastOutput ? `Last npm response: ${lastOutput}` : 'npm returned no output.',
    `Re-run the same publish:sdk command to resume.`,
  ].join('\n'))
}

/**
 * Commit the release (version bump) and tag it — idempotently, so a resume
 * that already committed/tagged on a prior run is a no-op rather than a
 * "nothing to commit" / "tag exists" failure.
 */
function ensureReleaseCommitAndTag(version: string): void {
  run('git', ['add', PKG_DIR], { cwd: WORKSPACE_ROOT })
  if (capture('git', ['diff', '--cached', '--name-only'], { cwd: WORKSPACE_ROOT })) {
    run('git', ['commit', '-m', `🔖 release v${version}`], { cwd: WORKSPACE_ROOT })
    log.log(`committed "🔖 release v${version}".`)
  }
  else {
    log.log('release commit already present — nothing new to commit.')
  }
  if (capture('git', ['tag', '--list', `v${version}`], { cwd: WORKSPACE_ROOT })) {
    log.log(`tag v${version} already exists.`)
  }
  else {
    run('git', ['tag', `v${version}`], { cwd: WORKSPACE_ROOT })
    log.log(`tagged v${version}.`)
  }
}

const positional = process.argv.slice(2).filter(a => !a.startsWith('--'))
const dryRun = process.argv.includes('--dry-run')
const releaseType = positional[0]

if (dryRun && releaseType)
  log.fail('--dry-run takes no version (it rehearses packaging only).')
if (!dryRun && !VALID_TYPES.has(releaseType))
  log.fail('usage: publish-sdk.ts <patch|minor|major> | --dry-run')

// 1) shared gate (once)
runPrepublishGates({ logger: log })

const originalRaw = fs.readFileSync(PKG_JSON, 'utf8')

// ── Dry run: build → publish --dry-run. No bump, no side effects.
if (dryRun) {
  log.log('packaging rehearsal — no version bump, nothing published.')
  run('npm', ['publish', '--access', 'public', '--dry-run'], { cwd: PKG_DIR, env: npmEnv })
  log.log('dry-run complete.')
  process.exit(0)
}

// ── Real release. Resume an in-flight one if its package is already on npm.
const existing = loadReleaseState()
const resuming = Boolean(existing?.steps.published && existing.version === JSON.parse(originalRaw).version)

let releasedVersion = ''
let state: ReleaseState

if (resuming && existing) {
  state = existing
  releasedVersion = state.version
  log.log(`resuming release v${releasedVersion} (already on npm) — continuing the remaining steps.`)
}
else {
  if (existing)
    log.warn(`discarding a stale release record (v${existing.version}); starting a fresh ${releaseType} release.`)

  if (!isLoggedIn(PKG_DIR))
    log.fail('not logged in to npm. Run `npm login` first (sessions expire — re-auth before each release).')

  try {
    // 2) bump our own version (persists past restore) — written directly, no npm.
    const bumped = JSON.parse(originalRaw)
    releasedVersion = bumpVersion(bumped.version, releaseType)
    bumped.version = releasedVersion
    fs.writeFileSync(PKG_JSON, `${JSON.stringify(bumped, null, 2)}\n`)
    log.log(`${PKG_NAME} → v${releasedVersion}`)

    // 3) build, publish.
    run('bun', ['run', 'sdk:build:ours'], { cwd: WORKSPACE_ROOT })
    run('npm', ['publish', '--access', 'public'], { cwd: PKG_DIR, env: npmEnv })
    log.log(`published ${PKG_NAME}@${releasedVersion}`)
  }
  catch (error) {
    fs.writeFileSync(PKG_JSON, originalRaw)
    log.fail(error instanceof Error ? error.message : String(error))
  }

  // Published — record the release so a later failure resumes here, never re-publishes.
  state = {
    version: releasedVersion,
    releaseType: releaseType as ReleaseState['releaseType'],
    steps: { published: true, committed: false, subtreePushed: false },
  }
  saveReleaseState(state)
}

// Past this point the package is on npm; the bump must stand. Each step is
// guarded by the release record, so a resume skips whatever already completed.
try {
  // 4) wait for registry propagation (safe to repeat).
  waitForNpm(releasedVersion)

  // 5) commit + tag the release.
  if (!state.steps.committed) {
    ensureReleaseCommitAndTag(releasedVersion)
    state.steps.committed = true
    saveReleaseState(state)
  }

  // 6) squash-push the public subtree.
  if (!state.steps.subtreePushed) {
    publishSubtree({ message: `🔖 release v${releasedVersion}`, skipVerify: true })
    state.steps.subtreePushed = true
    saveReleaseState(state)
  }
}
catch (error) {
  log.error(error instanceof Error ? error.message : String(error))
  log.error(`${PKG_NAME}@${releasedVersion} is published, but a later step failed.`)
  log.error(`resume from where it stopped by re-running: bun run publish:sdk:${state.releaseType}`)
  process.exit(1)
}

clearReleaseState()
log.log(`release v${releasedVersion} complete. Review, then: git push && git push --tags`)
