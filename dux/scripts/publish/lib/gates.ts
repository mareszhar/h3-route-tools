import type { Logger } from './shell.ts'
/**
 * The shared prepublish gates (dux-spec-workspace.md §9). One place that runs
 * the common verification — build, lint, typecheck, test — so every publish
 * path is provably verified the same way.
 *
 * The `publish:sdk:*` orchestrator runs this once up front and hands
 * `skipVerify` to the subtree step it drives in-process, so a release never
 * re-verifies what it just verified.
 *
 * The only way past the gate is the deliberately awkward
 * `H3DUX_UNSAFE_PUBLISH_SKIP_CHECKS=1` — there is no `--skip-checks` flag,
 * because a one-keystroke way to drop the safety rails is too tempting on a
 * tired night.
 *
 * A green run leaves a content-keyed receipt (verify-stamp.ts). The next run
 * skips the gate only when the receipt proves the gate's inputs are
 * byte-for-byte unchanged — so resuming a half-finished release doesn't
 * re-verify what was just verified, while any real edit re-verifies
 * automatically. `H3DUX_FORCE_VERIFY=1` ignores the receipt.
 */
import process from 'node:process'
import { WORKSPACE_ROOT } from './paths.ts'
import { createLogger, run } from './shell.ts'
import { computeInputsDigest, readStamp, writeStamp } from './verify-stamp.ts'

export const UNSAFE_SKIP_ENV = 'H3DUX_UNSAFE_PUBLISH_SKIP_CHECKS'
export const FORCE_VERIFY_ENV = 'H3DUX_FORCE_VERIFY'

/** The shared gates, in dependency order (build first so type/test see dist). */
const GATES: Array<[name: string, script: string]> = [
  ['build', 'sdk:build:ours'],
  ['lint', 'sdk:lint'],
  ['typecheck', 'sdk:typecheck'],
  ['test', 'sdk:test'],
]

/**
 * Run the shared gates. Honors the unsafe skip env (with a loud warning).
 * Throws on the first failing gate.
 */
export function runPrepublishGates({ logger = createLogger('prepublish') }: { logger?: Logger } = {}): void {
  if (process.env[UNSAFE_SKIP_ENV] === '1') {
    logger.warn(`shared gates SKIPPED via ${UNSAFE_SKIP_ENV}=1 — publishing UNVERIFIED.`)
    return
  }

  const digest = computeInputsDigest()
  if (digest && process.env[FORCE_VERIFY_ENV] !== '1') {
    const stamp = readStamp()
    if (stamp && stamp.digest === digest) {
      logger.log(`shared gates skipped — inputs unchanged since ${stamp.ranAt} (set ${FORCE_VERIFY_ENV}=1 to force a re-run).`)
      return
    }
  }

  logger.log(`running shared gates: ${GATES.map(([name]) => name).join(' · ')}`)
  for (const [name, script] of GATES) {
    logger.log(`gate: ${name}`)
    run('bun', ['run', script], { cwd: WORKSPACE_ROOT })
  }
  writeStamp(digest)
  logger.log('shared gates green ✅')
}
