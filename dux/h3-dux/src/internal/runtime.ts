/**
 * The shared route runtime (delta 13, step 9A). One implementation of the dux
 * request/event/error/response execution, consumed by both the standalone server
 * (`server.ts`, via the owned native app's `.route()`) and Nitro file routes
 * (`file-route.ts`, via the owned `defineRouteHandler`). Extracting it keeps the two surfaces
 * behaviourally identical — a fix lands once (dux-vision.md §3, principle 2).
 *
 * `buildMethod` turns one method's dux options into the baseline per-method def:
 * the `validate` block value-validates, plus a *wrapped* handler that adds the
 * dux layer — success status, root accessors, `event.valid`, typed `event.error`,
 * SSE streaming, and response-kind tagging.
 */
import type { H3Event } from 'h3'
import type { AnyMethodValidate, ErrorsOption } from './route-types.ts'
import type { OnValidationError, RouteMethod, SchemaWithJSON, ValidateSource } from './schema-types.ts'
import { createEventStream, getQuery, HTTPError } from 'h3'
import { ensureH3DuxAccessors } from '../middleware.ts'
import {
  isBinaryResponse,
  isTextResponse,
  runtimeResponseKind,
  setResponseKind,
} from '../response.ts'
import { isEventStream } from '../sse.ts'

/** One method's runtime options — the dux per-method contract, handler typed loosely. */
export interface MethodRuntimeOpts {
  status?: number
  onValidationError?: OnValidationError
  errors?: ErrorsOption
  validate?: AnyMethodValidate & { eager?: boolean }
  handler: (event: H3Event) => unknown
}

/** The per-scope schemas validated on demand in manual mode. */
interface Schemas { query?: SchemaWithJSON, body?: SchemaWithJSON, headers?: SchemaWithJSON }

/** Validate one scope against its schema; throw 422 (or the hook's shape) on failure. */
export async function validateScope(
  schema: SchemaWithJSON,
  value: unknown,
  source: ValidateSource,
  event: H3Event,
  onValidationError: OnValidationError | undefined,
): Promise<unknown> {
  const result = await schema['~standard'].validate(value)
  if (result.issues) {
    const details = onValidationError?.({ source, issues: result.issues, event })
    throw new HTTPError(details ?? {
      status: 422,
      statusText: 'Unprocessable Entity',
      message: `${source} validation failed`,
      data: { source, issues: result.issues },
    })
  }
  return result.value
}

/** Read a scope's raw, pre-validation value off the event. */
function readRaw(event: H3Event, scope: string): unknown {
  if (scope === 'query')
    return getQuery(event)
  if (scope === 'body')
    return event.req.json()
  if (scope === 'headers')
    return Object.fromEntries(event.req.headers.entries())
  return event.context.params
}

/** Attach `event.valid(scope)`: idempotent; reads (eager) or runs (manual) the validated value. */
function attachValid(
  event: H3Event,
  eager: boolean,
  schemas: Schemas,
  onValidationError: OnValidationError | undefined,
): void {
  const cache = new Map<string, unknown>()
  const ctx = event.context as Record<string, unknown>
  const validated = (event as { validated?: Record<string, unknown> }).validated

  ;(event as { valid?: unknown }).valid = async (scope: string): Promise<unknown> => {
    if (cache.has(scope))
      return cache.get(scope)
    let value: unknown
    if (scope === 'params') {
      value = event.context.params
    }
    else if (eager) {
      value = scope === 'body' ? await event.req.json() : validated?.[scope] ?? await readRaw(event, scope)
    }
    else {
      const schema = schemas[scope as keyof Schemas]
      const raw = await readRaw(event, scope)
      value = schema ? await validateScope(schema, raw, scope as ValidateSource, event, onValidationError) : raw
      ctx[scope] = value
    }
    cache.set(scope, value)
    return value
  }
}

/** Stream a handler's async iterable as a validated `text/event-stream`. */
function streamSse(
  event: H3Event,
  source: AsyncIterable<unknown>,
  schema: SchemaWithJSON,
  onValidationError: OnValidationError | undefined,
): unknown {
  const stream = createEventStream(event)
  void (async () => {
    try {
      for await (const chunk of source) {
        const tick = await validateScope(schema, chunk, 'response', event, onValidationError)
        await stream.push(JSON.stringify(tick))
      }
    }
    finally {
      await stream.close()
    }
  })()
  return stream.send()
}

/**
 * Standardize request-validation failures on 422, eager or manual (delta 9). The
 * user's hook still wins; response failures are re-wrapped to 500 by the validator.
 */
export function makeOnError(onValidationError: OnValidationError | undefined): OnValidationError {
  return ctx =>
    onValidationError?.(ctx) ?? {
      status: 422,
      statusText: 'Unprocessable Entity',
      message: `${ctx.source} validation failed`,
      data: { source: ctx.source, issues: ctx.issues },
    }
}

/** The per-method def: the value-validated `validate` block + the wrapped handler. */
export interface BuiltMethod {
  validate: AnyMethodValidate | undefined
  handler: (event: H3Event) => Promise<unknown>
  onValidationError: OnValidationError
}

/**
 * Build the baseline per-method def from one method's dux options. The returned
 * `validate` is what value-validates (request scopes in eager mode, the
 * response unless it is a stream/kind marker); the returned `handler` is the dux
 * wrapper that installs the root accessors, `event.valid`, typed `event.error`,
 * then runs the user handler and tags the response by kind (or streams SSE).
 */
export function buildMethod(method: RouteMethod, options: MethodRuntimeOpts): BuiltMethod {
  const { status, onValidationError, validate, handler } = options
  const eager = validate?.eager !== false
  const schemas: Schemas = { query: validate?.query, body: validate?.body, headers: validate?.headers }
  const sseSchema = isEventStream(validate?.response) ? (validate?.response as SchemaWithJSON) : undefined
  // Response kinds (delta 10): `text()`/`binary()` carry no schema to value-validate;
  // the server just sends the matching content type so the client decodes by kind.
  const isText = isTextResponse(validate?.response)
  const isBinary = isBinaryResponse(validate?.response)
  // The response schema value-validated by the baseline dispatcher (none for streams or kind markers).
  const response = (sseSchema || isText || isBinary) ? undefined : validate?.response
  const dispatchValidate = eager
    ? { query: schemas.query, body: schemas.body, headers: schemas.headers, response }
    : (response ? { response } : undefined)

  const onError = makeOnError(onValidationError)

  const wrapped = async (event: H3Event): Promise<unknown> => {
    if (status !== undefined)
      event.res.status = status
    // Install the root aliases (`event.params/query/body/bindings`) over the
    // canonical `event.context` store — idempotent with any middleware that ran.
    ensureH3DuxAccessors(event)
    attachValid(event, eager, schemas, onError)
    // `throw event.error(status, data)` — a typed thrower for the declared `errors` (delta 9).
    ;(event as { error?: unknown }).error = (errStatus: number, data?: unknown) =>
      new HTTPError({ status: errStatus, data })
    if (eager) {
      const ctx = event.context as Record<string, unknown>
      const validated = (event as { validated?: Record<string, unknown> }).validated
      ctx.query = validated?.query ?? getQuery(event)
      if (schemas.body)
        ctx.body = await event.req.json()
    }
    const result = await handler(event)
    if (sseSchema)
      return streamSse(event, result as AsyncIterable<unknown>, sseSchema, onError)
    if (result instanceof Response) {
      // A typedResponse() already carries kind + MIME. A plain native Response is
      // deliberately opaque and passes through untouched.
      return result
    }

    // The happy path is inferred from the actual handler value. Explicit markers
    // remain useful only when a schema's output is genuinely ambiguous.
    const kind = status === 204 || status === 205 || method === 'head'
      ? 'empty'
      : isText
        ? 'text'
        : isBinary
          ? 'binary'
          : runtimeResponseKind(result)
    if (kind === 'binary' && result instanceof Blob && result.type && !event.res.headers.has('content-type'))
      event.res.headers.set('content-type', result.type)
    if (kind !== 'empty' || (status !== 204 && status !== 205 && method !== 'head'))
      setResponseKind(event.res.headers, kind)
    return result
  }

  return { validate: dispatchValidate, handler: wrapped, onValidationError: onError }
}
