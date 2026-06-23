#!/usr/bin/env node
// Point Git at dux/.githooks so the dux commit guard runs. Idempotent and safe
// to re-run. Pass --optional (used by postinstall) to never fail the install.
import { execSync } from 'node:child_process'
import process from 'node:process'

const optional = process.argv.includes('--optional')

try {
  const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
  execSync('git config core.hooksPath dux/.githooks', { cwd: root, stdio: 'ignore' })
  execSync('chmod +x dux/.githooks/pre-commit', { cwd: root, stdio: 'ignore' })
  console.log('[dux] git hooks installed (core.hooksPath → dux/.githooks)')
}
catch (error) {
  if (optional) {
    process.exit(0)
  }
  console.error('[dux] failed to install git hooks:', error instanceof Error ? error.message : error)
  process.exit(1)
}
