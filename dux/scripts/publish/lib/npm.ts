/** Tiny npm-registry checks the publish flow needs — auth and propagation. */
import { capture } from './shell.ts'

/** Is the current `npm` session authenticated? */
export function isLoggedIn(cwd: string): boolean {
  return Boolean(capture('npm', ['whoami'], { cwd }))
}

/** Does `name@version` resolve on the registry right now? */
export function isVersionOnNpm(name: string, version: string, { preferOnline = false } = {}): boolean {
  const args = ['view', `${name}@${version}`, 'version']
  if (preferOnline)
    args.push('--prefer-online')
  return capture('npm', args) === version
}
