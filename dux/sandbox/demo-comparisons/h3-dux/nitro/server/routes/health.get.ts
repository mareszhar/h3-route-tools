import { defineFileRoute } from '@mszr/h3-dux'

export default defineFileRoute(() => ({ status: 'ripe' as const, at: new Date().toISOString() }))
