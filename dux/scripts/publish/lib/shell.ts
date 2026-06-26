/**
 * Run and log shell steps for the publishing scripts.
 *
 * One `run`/`capture`/`sleep` so every publish script spawns the same way
 * (inherited stdio, merged env, uniform error text) and reads the same.
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'

export interface RunOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  input?: string
}

/** Run a command, inheriting stdio by default; throw with context on failure. */
export function run(command: string, args: string[], opts: RunOptions = {}): void {
  const { env, ...rest } = opts
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    encoding: 'utf8',
    ...rest,
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) {
    const printable = [command, ...args].join(' ')
    throw new Error(`Command failed (${result.status ?? '?'}): ${printable}`)
  }
}

/** Run a command and return trimmed stdout (never throws; '' on failure). */
export function capture(command: string, args: string[], opts: RunOptions = {}): string {
  const { env, ...rest } = opts
  return spawnSync(command, args, {
    encoding: 'utf8',
    ...rest,
    env: { ...process.env, ...env },
  }).stdout?.trim() ?? ''
}

/** Block the event loop for `ms` (used by the npm-availability poll). */
export function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export interface Logger {
  log: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
  fail: (msg: string) => never
}

/** A tagged console; `fail` prints and exits non-zero. */
export function createLogger(tag: string): Logger {
  return {
    log: msg => console.log(`[${tag}] ${msg}`),
    warn: msg => console.warn(`[${tag}] ${msg}`),
    error: msg => console.error(`[${tag}] ${msg}`),
    fail: (msg): never => {
      console.error(`[${tag}] ${msg}`)
      process.exit(1)
    },
  }
}
