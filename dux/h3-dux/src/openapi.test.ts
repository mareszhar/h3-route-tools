import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { createRouter, createServer, defineMiddleware, toOpenAPI } from '@mszr/h3-dux'
import { expect, it } from 'vitest'

function schema<I, O>(
  input: Record<string, unknown>,
  output: Record<string, unknown> = input,
): StandardSchemaV1<I, O> & StandardJSONSchemaV1<I, O> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: value => ({ value: value as O }),
      jsonSchema: {
        input: () => input,
        output: () => output,
      },
    },
  }
}

const SignIn = schema(
  { $id: 'SignInInput', type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
)
const Session = schema(
  { $id: 'SessionInput', type: 'object', properties: { token: { type: 'string' } }, required: ['token'] },
  { $id: 'SessionOutput', type: 'object', properties: { token: { type: 'string' } }, required: ['token'] },
)
const ErrorBody = schema(
  { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
)
const Params = schema(
  { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
)

it('generates dux-aware OpenAPI for standalone routes', () => {
  const requireUser = defineMiddleware({
    openapi: { security: [{ bearerAuth: [] }] },
    handler: (_event, next) => next(),
  })
  const auth = createRouter('/auth', { openapi: { tags: ['Auth'] } })
    .post('/sign-in', {
      middleware: [requireUser],
      validate: { body: SignIn, response: { 200: Session, 401: ErrorBody } },
      errors: { 409: ErrorBody },
      openapi: { summary: 'Sign in', operationId: 'signIn' },
      handler: () => ({ token: 'ok' }),
    })

  const app = createServer()
    .mount(auth)
    .get('/hidden', { openapi: false, handler: () => ({ ok: true }) })
    .get('/users/:id', {
      params: Params,
      validate: { response: Session },
      handler: () => ({ token: 'ok' }),
    })

  const doc = toOpenAPI(app, {
    info: { title: 'Test API', version: '1.0.0' },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
  })

  expect(doc.paths['/hidden']).toBeUndefined()
  const signIn = doc.paths['/auth/sign-in']?.post
  expect(signIn?.summary).toBe('Sign in')
  expect(signIn?.operationId).toBe('signIn')
  expect(signIn?.tags).toEqual(['Auth'])
  expect((signIn as { security?: unknown } | undefined)?.security).toEqual([{ bearerAuth: [] }])
  expect(signIn?.responses?.['422']).toBeDefined()
  expect(signIn?.responses?.['409']?.content?.['application/json']?.schema).toMatchObject({
    properties: { status: { const: 409 } },
  })

  const bodyRef = signIn?.requestBody?.content['application/json']?.schema
  expect(bodyRef).toEqual({ $ref: '#/components/schemas/SignInInput' })
  const schemas = doc.components?.schemas as Record<string, unknown> | undefined
  expect(schemas?.SignInInput).toBeDefined()
  expect(schemas?.SessionOutput).toBeDefined()

  const idParam = doc.paths['/users/{id}']?.get?.parameters?.find(param => param.name === 'id')
  expect(idParam?.schema).toEqual({ type: 'string' })
})
