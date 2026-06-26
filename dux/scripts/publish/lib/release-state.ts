/**
 * The in-flight release record (dux-spec-workspace.md §9).
 *
 * A release is publish-then-orchestrate: once `@mszr/h3-dux@<v>` is on npm the
 * bump is permanent and the remaining steps (release commit + tag, public
 * subtree push) must still happen. If one of them fails, the maintainer
 * re-runs the same `publish:sdk:<type>` and the orchestrator resumes from the
 * first incomplete step instead of re-doing — or worse, re-bumping — what's
 * done.
 *
 * The record is the single source of truth for "where did this release get
 * to". It lives in the gitignored scratch dir and is cleared once the release
 * lands.
 */
import fs from 'node:fs'
import path from 'node:path'
import { STATE_DIR } from './paths.ts'

const STATE_FILE = path.join(STATE_DIR, 'release-state.json')

export interface ReleaseState {
  version: string
  releaseType: 'patch' | 'minor' | 'major'
  steps: {
    published: boolean
    committed: boolean
    subtreePushed: boolean
  }
}

/** The saved release record, or `null` if no release is in flight. */
export function loadReleaseState(): ReleaseState | null {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  }
  catch {
    return null
  }
}

export function saveReleaseState(state: ReleaseState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`)
}

export function clearReleaseState(): void {
  fs.rmSync(STATE_FILE, { force: true })
}
