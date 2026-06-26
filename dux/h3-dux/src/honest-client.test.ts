import type { App } from '@test'
import { createClient, createTestClient, H3DuxHTTPError, H3DuxTransportError } from '@mszr/h3-dux'
import { app } from '@test'
import { expect, it } from 'vitest'

const api = createTestClient<App>(app)

it('a success resolves to { data, error: undefined }', async () => {
  const { data, error } = await api.get('/fruits/:id', { params: { id: 'mango' } })
  expect(error).toBeUndefined()
  expect(data?.name).toBe('Mango')
})

it('a typed error resolves to a discriminated { error } (delta 9)', async () => {
  const { data, error } = await api.post('/fruits/:id/reserve', { params: { id: 'taken' } })
  expect(data).toBeUndefined()
  expect(error?.kind).toBe('http')
  if (error?.kind === 'http') {
    expect(error.status).toBe(409)
    // error.data is the declared payload, unwrapped from h3's envelope.
    expect(error.data).toEqual({ error: 'conflict', message: 'already reserved' })
    expect(error.response.status).toBe(409)
  }
})

it('a reserved-free id returns the success body', async () => {
  const { data, error } = await api.post('/fruits/:id/reserve', { params: { id: 'kiwi' } })
  expect(error).toBeUndefined()
  expect(data).toEqual({ id: 'kiwi', reserved: true })
})

it('.orThrow() returns data on success', async () => {
  const data = await api.get('/health').orThrow()
  expect(data.status).toBe('ripe')
})

it('.orThrow() rejects with a H3DuxHTTPError on a non-2xx', async () => {
  await expect(api.post('/fruits/:id/reserve', { params: { id: 'taken' } }).orThrow())
    .rejects
    .toBeInstanceOf(H3DuxHTTPError)
  try {
    await api.post('/fruits/:id/reserve', { params: { id: 'taken' } }).orThrow()
  }
  catch (error) {
    expect(error).toBeInstanceOf(H3DuxHTTPError)
    expect((error as H3DuxHTTPError).status).toBe(409)
    expect((error as H3DuxHTTPError<409, { error: string }>).data.error).toBe('conflict')
  }
})

it('.raw() exposes the native response and never throws on a non-2xx', async () => {
  const res = await api.post('/fruits/:id/reserve', { params: { id: 'taken' } }).raw()
  expect(res.status).toBe(409)
  expect(res.ok).toBe(false)
})

it('a request validation failure is a typed 422 (eager, standardized)', async () => {
  const { error } = await api.post('/fruits', {
    body: { name: 'Bad', emoji: '🤕', color: 'brown', tags: [], pricePerKg: -5, stockKg: 1 },
  })
  expect(error?.kind).toBe('http')
  if (error?.kind === 'http') {
    expect(error.status).toBe(422)
    expect((error.data as { source: string }).source).toBe('body')
    expect(Array.isArray((error.data as { issues: unknown[] }).issues)).toBe(true)
  }
})

it('a transport failure is a H3DuxTransportError, never an HTTP error', async () => {
  const offline = createClient<App>({ fetch: () => Promise.reject(new Error('network down')) })
  const { data, error } = await offline.get('/health')
  expect(data).toBeUndefined()
  expect(error).toBeInstanceOf(H3DuxTransportError)
  expect(error?.kind).toBe('transport')
})
