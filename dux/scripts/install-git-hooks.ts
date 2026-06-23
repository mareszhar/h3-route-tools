#!/usr/bin/env bun
/**
 * Point Git at dux/.githooks so the dux commit guard runs. Idempotent and safe
 * to re-run. Pass --optional (used by postinstall) to never fail the install.
 */
import { execSync } from 'node:child_process'
import process from 'node:process'

const optional = process.argv.includes('--optional')
const HOOKS_PATH = 'dux/.githooks'

function git(args: string, cwd?: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

try {
  const root = git('rev-parse --show-toplevel')
  let current = ''
  try {
    current = git('config --get core.hooksPath', root)
  }
  catch {
    // unset — fall through and set it
  }

  if (current !== HOOKS_PATH) {
    git(`config core.hooksPath ${HOOKS_PATH}`, root)
    execSync('chmod +x dux/.githooks/pre-commit', { cwd: root })
    console.log(`[dux] git hooks installed (core.hooksPath → ${HOOKS_PATH})`)
  }
  else {
    console.log(`[dux] git hooks already installed (core.hooksPath → ${HOOKS_PATH})`)
  }
}
catch (error) {
  if (optional) {
    process.exit(0)
  }
  console.error('[dux] failed to install git hooks:', error instanceof Error ? error.message : error)
  process.exit(1)
}
