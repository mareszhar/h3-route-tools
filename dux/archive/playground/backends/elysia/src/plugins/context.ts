import { createOrchard } from '@orchard/domain'
import { Elysia } from 'elysia'

/**
 * Decorates the shared Orchard repository onto the context. Named, so Elysia
 * deduplicates it — every route group resolves the same single instance.
 */
export const context = new Elysia({ name: 'orchard/context' }).decorate('orchard', createOrchard())
