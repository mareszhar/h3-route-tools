/** Tiny npm-registry checks the publish flow needs — auth and propagation. */
import { spawnSync } from 'node:child_process'
import { NPM_CACHE_DIR } from './paths.ts'
import { capture } from './shell.ts'

export const npmEnv = {
  npm_config_cache: NPM_CACHE_DIR,
  npm_config_loglevel: 'error',
}

export interface NpmVersionCheck {
  found: boolean
  output: string
  status: number | null
}

/** Is the current `npm` session authenticated? */
export function isLoggedIn(cwd: string): boolean {
  return Boolean(capture('npm', ['whoami'], { cwd, env: npmEnv }))
}

/** Does `name@version` resolve on the registry right now? */
export function checkVersionOnNpm(name: string, version: string, { preferOnline = false } = {}): NpmVersionCheck {
  const args = ['view', `${name}@${version}`, 'version']
  if (preferOnline)
    args.push('--prefer-online')
  args.push('--workspaces=false')

  const result = spawnSync('npm', args, {
    encoding: 'utf8',
    env: { ...process.env, ...npmEnv },
  })

  const stdout = result.stdout?.trim() ?? ''
  const stderr = result.stderr?.trim() ?? ''
  return {
    found: result.status === 0 && stdout === version,
    output: stdout || stderr,
    status: result.status,
  }
}
