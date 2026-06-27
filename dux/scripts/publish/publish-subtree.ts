#!/usr/bin/env bun
/**
 * Mirror the published package to the public repo as a SINGLE SQUASHED commit
 * (dux-spec-workspace.md §9). The fork keeps the granular commit history; the
 * public face of the SDK stays clean — one snapshot commit per push. We build
 * that commit with plumbing: the tree of `dux/h3-dux` at HEAD, parented on the
 * current remote tip, pushed fast-forward. No subtree history is replayed
 * publicly.
 *
 * Runnable ad hoc (`bun run publish:subtree:squash`) or driven by
 * `publish:sdk:*`. Ad hoc it runs the shared gate first and opens $GIT_EDITOR
 * to compose the squash message — prefilled with the convention-following
 * default (`🔖 release v<version>` from the package), so saving as-is is one
 * keystroke and editing is right there. Pass `--message` to skip the editor:
 *
 *   bun run publish:subtree:squash -- --message "🔖 release v0.1.0"
 *   bun run publish:subtree:squash -- --tag v1.0.1
 *
 * An automatic version-derived message is the happy path's job, not the
 * ad-hoc one's: the `publish:sdk:*` orchestrator always passes `--message`,
 * so a release never opens an editor; a maintainer running the push by hand
 * picks the message.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { runPrepublishGates } from './lib/gates.ts'
import { DEFAULT_REMOTE, SUBTREE_PREFIX, WORKSPACE_ROOT } from './lib/paths.ts'
import { capture, createLogger, run } from './lib/shell.ts'

const log = createLogger('subtree')

/** The default squash message — `🔖 release v<version>` from the package at HEAD. */
function defaultSubtreeMessage(repoRoot: string): string {
  const rawPkg = capture('git', ['show', `HEAD:${SUBTREE_PREFIX}/package.json`], { cwd: repoRoot })
  const version = rawPkg ? JSON.parse(rawPkg).version : undefined
  return version ? `🔖 release v${version}` : '🔖 publish h3-dux'
}

/** Resolve the configured git editor on a prefilled template; return the message. */
function composeMessageInEditor(repoRoot: string): string {
  const editor = capture('git', ['var', 'GIT_EDITOR'], { cwd: repoRoot }) || process.env.EDITOR || 'vi'
  const file = path.join(os.tmpdir(), `h3-dux-subtree-msg-${Date.now()}.txt`)
  fs.writeFileSync(file, `${defaultSubtreeMessage(repoRoot)}\n`)

  const result = spawnSync(`${editor} "${file}"`, { stdio: 'inherit', shell: true })
  if (result.status !== 0) {
    fs.rmSync(file, { force: true })
    log.fail('editor exited non-zero — aborting.')
  }

  const message = fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => !line.startsWith('#'))
    .join('\n')
    .trim()
  fs.rmSync(file, { force: true })

  if (!message)
    log.fail('empty commit message — aborting.')
  return message
}

/**
 * Push the prefix as one squashed commit to `remote`/`branch`.
 * @returns the pushed commit sha, or `null` on a dry run.
 */
export function publishSubtree({
  remote = DEFAULT_REMOTE,
  branch = 'main',
  message,
  tag,
  dryRun = false,
  skipVerify = false,
}: {
  remote?: string
  branch?: string
  message?: string
  tag?: string | false
  dryRun?: boolean
  skipVerify?: boolean
} = {}): string | null {
  const repoRoot = capture('git', ['rev-parse', '--show-toplevel'], { cwd: WORKSPACE_ROOT })
  if (!repoRoot)
    log.fail('not inside a git repository.')

  if (capture('git', ['status', '--porcelain'], { cwd: repoRoot }))
    log.fail('working tree is not clean. Commit first (the squash snapshots HEAD).')

  if (!skipVerify)
    runPrepublishGates({ logger: log })

  const squashMessage = message ?? composeMessageInEditor(repoRoot)

  // The tree object for the prefix as it stands at HEAD — the squash payload.
  const sourceTree = capture('git', ['rev-parse', `HEAD:${SUBTREE_PREFIX}`], { cwd: repoRoot })
  if (!sourceTree)
    log.fail(`could not resolve a committed tree at ${SUBTREE_PREFIX}.`)

  // Parent = the current remote tip, so the push fast-forwards (empty on first push).
  let parent = ''
  if (capture('git', ['ls-remote', '--heads', remote, branch], { cwd: repoRoot })) {
    run('git', ['fetch', remote, branch], { cwd: repoRoot })
    parent = capture('git', ['rev-parse', 'FETCH_HEAD'], { cwd: repoRoot })
  }

  log.log(`squashing ${SUBTREE_PREFIX} → ${remote} (${branch})${parent ? '' : ' [first push]'}`)
  log.log(`message: ${squashMessage.split('\n')[0]}`)

  if (dryRun) {
    log.log('--dry-run: would commit-tree the snapshot and push it; stopping here.')
    return null
  }

  const commit = capture('git', [
    'commit-tree',
    sourceTree,
    ...(parent ? ['-p', parent] : []),
    '-m',
    squashMessage,
  ], { cwd: repoRoot })
  if (!commit)
    log.fail('git commit-tree produced no commit.')

  run('git', ['push', remote, `${commit}:refs/heads/${branch}`], { cwd: repoRoot })
  log.log(`pushed ${commit.slice(0, 10)} to ${branch}.`)

  if (tag) {
    if (capture('git', ['ls-remote', '--tags', remote, tag], { cwd: repoRoot })) {
      log.log(`tag ${tag} already exists on ${remote}; leaving it untouched.`)
    }
    else {
      run('git', ['push', remote, `${commit}:refs/tags/${tag}`], { cwd: repoRoot })
      log.log(`pushed tag ${tag} to ${remote}.`)
    }
  }

  return commit
}

// CLI entry — only when invoked directly, not when imported by publish-sdk.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2)
  const valueOf = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined
  }
  publishSubtree({
    remote: valueOf('--remote'),
    branch: valueOf('--branch'),
    message: valueOf('--message'),
    tag: valueOf('--tag'),
    dryRun: argv.includes('--dry-run'),
  })
}
