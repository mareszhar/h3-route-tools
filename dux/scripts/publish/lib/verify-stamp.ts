/**
 * The content-keyed verification receipt (dux-spec-workspace.md §6).
 *
 * The shared gate (build · lint · typecheck · test) is the expensive part of a
 * release, and a release runs several publish steps after it. When a release
 * dies mid-way and is resumed, re-running the gate is pure waste *iff nothing
 * it checks has changed* — but "nothing changed" must be proven, not assumed
 * on a timer. So the receipt is keyed to a digest of the gate's exact inputs:
 * identical inputs ⇒ a safe skip; any change ⇒ the digest differs and the gate
 * runs again. No flags, no "trust me".
 *
 * The digest is the git tree-hash of the gate's source inputs, staged into a
 * throwaway index — the version field is masked out of the package manifest
 * first, since bumping it is a legitimate release-time churn the gate doesn't
 * actually test.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { PKG_JSON, STATE_DIR, WORKSPACE_ROOT } from './paths.ts'
import { capture, run } from './shell.ts'

const STAMP_FILE = path.join(STATE_DIR, 'verify-stamp.json')

/** Repo-relative inputs the gate's verdict depends on. */
const VERIFICATION_PATHS = [
  'dux/h3-dux/src',
  'dux/h3-dux/tsconfig.json',
  'dux/h3-dux/vitest.config.ts',
  'dux/h3-dux/build.config.ts',
  'dux/eslint.config.ts',
  'dux/tsconfig.base.json',
  'dux/bun.lock',
]

/** The package manifest with the release-churned version field dropped. */
function normalizedPkgManifest(): string {
  const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'))
  delete pkg.version
  return `${JSON.stringify(pkg, null, 2)}\n`
}

/**
 * The digest of the gate's current inputs, or `null` if it can't be computed
 * (no git, etc.) — callers treat `null` as "can't prove it, so verify".
 */
export function computeInputsDigest(): string | null {
  const repoRoot = capture('git', ['rev-parse', '--show-toplevel'], { cwd: WORKSPACE_ROOT })
  if (!repoRoot)
    return null

  const present = VERIFICATION_PATHS.filter(p => fs.existsSync(path.join(repoRoot, p)))
  const indexFile = path.join(os.tmpdir(), `h3-dux-verify-index-${process.pid}-${Date.now()}.index`)
  const env = { GIT_INDEX_FILE: indexFile }
  try {
    run('git', ['read-tree', '--empty'], { cwd: repoRoot, env })
    run('git', ['add', '-f', '--', ...present], { cwd: repoRoot, env })

    const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repoRoot,
      input: normalizedPkgManifest(),
      encoding: 'utf8',
    })
    if (blob.status !== 0)
      return null
    run('git', ['update-index', '--add', '--cacheinfo', '100644', blob.stdout.trim(), 'dux/h3-dux/package.json'], { cwd: repoRoot, env })

    const tree = capture('git', ['write-tree'], { cwd: repoRoot, env })
    return tree || null
  }
  catch {
    return null
  }
  finally {
    fs.rmSync(indexFile, { force: true })
  }
}

export interface VerifyStamp {
  digest: string
  ranAt: string
}

export function readStamp(): VerifyStamp | null {
  try {
    return JSON.parse(fs.readFileSync(STAMP_FILE, 'utf8'))
  }
  catch {
    return null
  }
}

export function writeStamp(digest: string | null): void {
  if (!digest)
    return
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(STAMP_FILE, `${JSON.stringify({ digest, ranAt: new Date().toISOString() }, null, 2)}\n`)
}
