/**
 * Resolve workspace filesystem anchors for the publishing scripts. One source
 * of truth so a moved directory is a one-line fix, not a hunt across scripts.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url))

/** `dux/` — the maintainer workspace. */
export const WORKSPACE_ROOT = path.resolve(LIB_DIR, '..', '..', '..')
/** `dux/h3-dux` — the published package. */
export const PKG_DIR = path.resolve(WORKSPACE_ROOT, 'h3-dux')
export const PKG_JSON = path.resolve(PKG_DIR, 'package.json')
/** Gitignored scratch dir for release machinery (verify stamp, release state). */
export const STATE_DIR = path.resolve(WORKSPACE_ROOT, '.dux')
/** Workspace-local npm cache, avoiding user-cache permission issues during release checks. */
export const NPM_CACHE_DIR = path.resolve(WORKSPACE_ROOT, '.npm-cache')
/** The published package's npm name. */
export const PKG_NAME = '@mszr/h3-dux'
/** Path of the package relative to the outer repo root — the subtree prefix. */
export const SUBTREE_PREFIX = 'dux/h3-dux'
/** The public mirror this fork's subtree squashes onto. */
export const DEFAULT_REMOTE = 'https://github.com/mareszhar/h3-dux.git'
