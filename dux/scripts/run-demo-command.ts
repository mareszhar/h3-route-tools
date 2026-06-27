#!/usr/bin/env bun
/**
 * Run maintainer commands across the sandbox demo packages discovered from the
 * workspace manifest. The script is intentionally boring: one discovery path,
 * predictable skips, and install refreshes only at the workspace root.
 *
 * Usage:
 *   bun scripts/run-demo-command.ts list
 *   bun scripts/run-demo-command.ts typecheck
 *   bun scripts/run-demo-command.ts build --scope h3-dux
 *   bun scripts/run-demo-command.ts upi --scope comparisons
 *   bun scripts/run-demo-command.ts refresh
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

type DemoCommand = 'list' | 'upi' | 'install' | 'refresh' | 'typecheck' | 'build' | 'prep'
type Scope = 'all' | 'main' | 'comparisons' | 'fixtures' | 'h3' | 'h3-dux' | 'hono' | 'elysia'

interface PackageJson {
  name?: string
  scripts?: Record<string, string>
  workspaces?: string[]
}

interface DemoPackage {
  name: string
  root: string
  relativeRoot: string
  scripts: Record<string, string>
}

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..')
const PACKAGE_JSON = path.join(WORKSPACE_ROOT, 'package.json')
const COMMANDS = new Set<DemoCommand>(['list', 'upi', 'install', 'refresh', 'typecheck', 'build', 'prep'])
const SCOPES = new Set<Scope>(['all', 'main', 'comparisons', 'fixtures', 'h3', 'h3-dux', 'hono', 'elysia'])

function readPackageJson(filePath: string): PackageJson {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageJson
}

function usage(): never {
  console.error([
    'Usage: bun scripts/run-demo-command.ts <list|upi|install|refresh|typecheck|build|prep> [--scope <all|main|comparisons|fixtures|h3|h3-dux|hono|elysia>]',
    '',
    'Examples:',
    '  bun scripts/run-demo-command.ts list',
    '  bun scripts/run-demo-command.ts typecheck',
    '  bun scripts/run-demo-command.ts build --scope h3-dux',
    '  bun scripts/run-demo-command.ts upi --scope comparisons',
    '  bun scripts/run-demo-command.ts refresh',
  ].join('\n'))
  process.exit(1)
}

function parseArgs(argv: string[]): { command: DemoCommand, scope: Scope } {
  const command = argv[0] as DemoCommand | undefined
  let scope: Scope = 'all'

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--scope') {
      const value = argv[index + 1] as Scope | undefined
      if (!value || !SCOPES.has(value))
        usage()
      scope = value
      index += 1
      continue
    }
    usage()
  }

  if (!command || !COMMANDS.has(command))
    usage()

  return { command, scope }
}

function existsDirectory(directory: string): boolean {
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory()
}

function workspacePackageRoots(pattern: string): string[] {
  const segments = pattern.split('/')
  const roots: string[] = []

  function visit(directory: string, index: number): void {
    if (index >= segments.length) {
      const pkg = path.join(directory, 'package.json')
      if (fs.existsSync(pkg))
        roots.push(directory)
      return
    }

    const segment = segments[index]
    if (segment === '*') {
      if (!existsDirectory(directory))
        return
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory())
          visit(path.join(directory, entry.name), index + 1)
      }
      return
    }

    visit(path.join(directory, segment), index + 1)
  }

  visit(WORKSPACE_ROOT, 0)
  return roots
}

function discoverDemoPackages(scope: Scope): DemoPackage[] {
  const workspace = readPackageJson(PACKAGE_JSON)
  const roots = new Set<string>()

  for (const pattern of workspace.workspaces ?? []) {
    if (!pattern.startsWith('sandbox/'))
      continue
    for (const root of workspacePackageRoots(pattern))
      roots.add(root)
  }

  return [...roots]
    .map((root) => {
      const pkg = readPackageJson(path.join(root, 'package.json'))
      return {
        name: pkg.name ?? path.basename(root),
        root,
        relativeRoot: path.relative(WORKSPACE_ROOT, root),
        scripts: pkg.scripts ?? {},
      }
    })
    .filter(pkg => matchesScope(pkg.relativeRoot, scope))
    .sort((a, b) => a.relativeRoot.localeCompare(b.relativeRoot))
}

function matchesScope(relativeRoot: string, scope: Scope): boolean {
  if (scope === 'all')
    return true
  if (scope === 'main')
    return relativeRoot.startsWith('sandbox/demo-main/')
  if (scope === 'comparisons')
    return relativeRoot.startsWith('sandbox/demo-comparisons/')
  if (scope === 'fixtures')
    return relativeRoot === 'sandbox/demo-comparisons/fixtures'
  return relativeRoot.startsWith(`sandbox/demo-comparisons/${scope}/`)
}

function run(command: string, args: string[], options: { cwd?: string } = {}): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? WORKSPACE_ROOT,
    stdio: 'inherit',
    env: { ...process.env },
  })

  if (result.status !== 0) {
    const printable = [command, ...args].join(' ')
    throw new Error(`Command failed (${result.status ?? '?'}): ${printable}`)
  }
}

function logPackageList(packages: DemoPackage[]): void {
  if (packages.length === 0) {
    console.log('[demo:list] no demo packages found.')
    return
  }

  for (const pkg of packages)
    console.log(`${pkg.relativeRoot} (${pkg.name})`)
  console.log(`[demo:list] ${packages.length} package${packages.length === 1 ? '' : 's'}`)
}

function runPackageScript(command: 'typecheck' | 'build' | 'prep', packages: DemoPackage[]): void {
  let ran = 0
  for (const pkg of packages) {
    if (!pkg.scripts[command]) {
      console.log(`[demo:${command}] skip ${pkg.relativeRoot} (no "${command}" script)`)
      continue
    }
    console.log(`[demo:${command}] ${pkg.relativeRoot}`)
    run('bun', ['run', command], { cwd: pkg.root })
    ran += 1
  }
  console.log(`[demo:${command}] complete (${ran} run, ${packages.length - ran} skipped)`)
}

function runPackageUpdates(packages: DemoPackage[]): void {
  for (const pkg of packages) {
    console.log(`[demo:upi] ${pkg.relativeRoot}`)
    run('bunx', ['npm-check-updates', '-i', '--packageFile', path.join(pkg.root, 'package.json')])
  }
  console.log(`[demo:upi] complete (${packages.length} package${packages.length === 1 ? '' : 's'})`)
}

function refreshInstall(): void {
  console.log('[demo:refresh] bun install')
  run('bun', ['install'])
  console.log('[demo:refresh] install refreshed')
}

const { command, scope } = parseArgs(process.argv.slice(2))
const packages = discoverDemoPackages(scope)

if (command === 'list') {
  logPackageList(packages)
}
else if (command === 'install' || command === 'refresh') {
  refreshInstall()
}
else if (command === 'upi') {
  runPackageUpdates(packages)
}
else {
  runPackageScript(command, packages)
}
