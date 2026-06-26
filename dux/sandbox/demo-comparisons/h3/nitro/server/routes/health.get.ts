import { defineHandler } from 'h3'

export default defineHandler(() => ({ status: 'ripe' as const, at: new Date().toISOString() }))
