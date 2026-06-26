import { Elysia } from 'elysia'

export const health = new Elysia({ name: 'orchard/health' }).get('/health', () => ({
  status: 'ripe' as const,
  at: new Date().toISOString(),
}))
