import type { StandardJSONSchemaV1, StandardTypedV1 } from '@standard-schema/spec'
import type { H3DuxOpenAPIObject } from './internal/openapi-types.ts'
import type { AnyMethodValidate } from './internal/route-types.ts'
import type {
  BodyValidation,
  JSONSchemaDocument,
  RouteMethod,
  SchemaWithJSON,
  StatusCodeKey,
} from './internal/schema-types.ts'
import { isBinaryResponse, isTextResponse } from './response.ts'
import { isEventStream } from './sse.ts'

export interface ToOpenAPIOptions {
  info: OpenAPIInfo
  servers?: Array<Record<string, unknown>>
  tags?: Array<Record<string, unknown>>
  security?: Array<Record<string, string[]>>
  components?: {
    schemas?: ComponentsRegistry
    securitySchemes?: Record<string, unknown>
    [key: string]: unknown
  }
  mapSchema?: (schema: StandardTypedV1, context: MapSchemaContext) => JSONSchemaDocument | undefined
  onUnrepresentable?: 'empty' | 'warn'
}

type ComponentsRegistry = Record<string, JSONSchemaDocument>

export interface OpenAPIInfo {
  title: string
  version: string
  summary?: string
  description?: string
  termsOfService?: string
  contact?: { name?: string, url?: string, email?: string }
  license?: { name: string, identifier?: string, url?: string }
}

export interface OpenAPIParameter {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  required?: boolean
  description?: string
  schema?: JSONSchemaDocument
}

export interface OpenAPIMediaType {
  schema?: JSONSchemaDocument
}

export interface OpenAPIRequestBody {
  description?: string
  required?: boolean
  content: Record<string, OpenAPIMediaType>
}

export interface OpenAPIResponse {
  description: string
  content?: Record<string, OpenAPIMediaType>
}

export interface OpenAPIOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: OpenAPIParameter[]
  requestBody?: OpenAPIRequestBody
  responses?: Record<StatusCodeKey, OpenAPIResponse>
  deprecated?: boolean
  security?: Array<Record<string, string[]>>
  externalDocs?: Record<string, unknown>
}

export type OpenAPIPathItem = {
  [M in RouteMethod]?: OpenAPIOperation;
} & {
  summary?: string
  description?: string
  parameters?: OpenAPIParameter[]
}

export interface MapSchemaContext {
  direction: 'input' | 'output'
  source: 'params' | 'query' | 'headers' | 'body' | 'response'
  route: string
  method: RouteMethod
  status?: StatusCodeKey
}

export interface H3DuxOpenAPIDocument {
  openapi: '3.1.0'
  info: OpenAPIInfo
  paths: Record<string, OpenAPIPathItem>
  components?: Record<string, unknown>
  servers?: Array<Record<string, unknown>>
  tags?: Array<Record<string, unknown>>
  security?: Array<Record<string, string[]>>
}

export interface H3DuxOpenAPIRoute {
  route: string
  method: RouteMethod
  params?: SchemaWithJSON
  validate?: AnyMethodValidate & { eager?: boolean }
  status?: number
  errors?: Partial<Record<StatusCodeKey, SchemaWithJSON>>
  openapi?: H3DuxOpenAPIObject
}

const ROUTES = new WeakMap<object, H3DuxOpenAPIRoute[]>()
export function recordOpenAPIRoute(owner: object, route: H3DuxOpenAPIRoute): void {
  const routes = ROUTES.get(owner) ?? []
  routes.push(route)
  ROUTES.set(owner, routes)
}

export function openAPIRoutesOf(owner: object): readonly H3DuxOpenAPIRoute[] {
  return ROUTES.get(owner) ?? []
}

export function toOpenAPI(app: object, options: ToOpenAPIOptions): H3DuxOpenAPIDocument {
  return buildOpenAPI(openAPIRoutesOf(app), options)
}

export function buildOpenAPI(routes: readonly H3DuxOpenAPIRoute[], options: ToOpenAPIOptions): H3DuxOpenAPIDocument {
  const paths: Record<string, OpenAPIPathItem> = {}
  let components: ComponentsRegistry = { ...(options.components?.schemas ?? {}) }

  const schema = (
    value: StandardTypedV1,
    context: MapSchemaContext,
  ): JSONSchemaDocument | undefined => {
    const mapped = options.mapSchema?.(value, context)
    const json = mapped ?? getStandardJSONSchema(value, { direction: context.direction })
    if (!json) {
      if (options.onUnrepresentable === 'warn')
        console.warn(`[h3-dux] OpenAPI: ${context.method.toUpperCase()} ${context.route} ${context.source} schema could not be represented; using {}.`)
      return undefined
    }
    const extracted = extractComponents(json, components)
    components = extracted.components
    return extracted.schema
  }

  for (const route of routes) {
    if (route.openapi?.hide)
      continue
    const path = toOpenAPIPath(route.route)
    const item = paths[path] ?? {}
    const operation = toOperation(route, schema)
    if (Object.keys(operation).length > 0)
      item[route.method] = operation
    paths[path] = item
  }

  const doc: H3DuxOpenAPIDocument = { openapi: '3.1.0', info: options.info, paths }
  const mergedComponents = { ...options.components, ...(Object.keys(components).length ? { schemas: components } : {}) }
  if (Object.keys(mergedComponents).length)
    doc.components = mergedComponents
  if (options.servers)
    doc.servers = options.servers
  if (options.tags)
    doc.tags = options.tags
  if (options.security)
    doc.security = options.security
  return doc
}

function toOperation(
  route: H3DuxOpenAPIRoute,
  schema: (value: StandardTypedV1, context: MapSchemaContext) => JSONSchemaDocument | undefined,
): OpenAPIOperation {
  const operation: OpenAPIOperation = {}
  applyOperationMeta(operation, route.openapi)

  const parameters = [
    ...pathParameters(route, schema),
    ...(route.validate?.query ? schemaToParameters(route.validate.query, 'query', route, schema) : []),
    ...(route.validate?.headers ? schemaToParameters(route.validate.headers, 'header', route, schema) : []),
  ]
  if (parameters.length)
    operation.parameters = parameters

  if (route.validate?.body)
    operation.requestBody = toRequestBody(route, route.validate.body, schema)

  const responses = toResponses(route, schema)
  if (Object.keys(responses).length)
    operation.responses = responses

  return operation
}

function pathParameters(
  route: H3DuxOpenAPIRoute,
  schema: (value: StandardTypedV1, context: MapSchemaContext) => JSONSchemaDocument | undefined,
): OpenAPIParameter[] {
  if (route.params) {
    return schemaToParameters(route.params, 'path', route, schema)
      .map(parameter => ({ ...parameter, required: true }))
  }
  return [...route.route.matchAll(/(?:\*\*:|:)(\w+)/g)].map(match => ({
    name: match[1]!,
    in: 'path' as const,
    required: true,
    schema: { type: 'string' },
  }))
}

function schemaToParameters(
  value: SchemaWithJSON,
  where: 'path' | 'query' | 'header',
  route: H3DuxOpenAPIRoute,
  schema: (value: StandardTypedV1, context: MapSchemaContext) => JSONSchemaDocument | undefined,
): OpenAPIParameter[] {
  const json = schema(value, { direction: 'input', source: where === 'path' ? 'params' : where === 'header' ? 'headers' : 'query', route: route.route, method: route.method })
  const properties = asRecord(json?.properties)
  if (!properties)
    return []
  const required = new Set(Array.isArray(json?.required) ? json.required.filter((item): item is string => typeof item === 'string') : [])
  return Object.entries(properties).map(([name, propSchema]) => ({
    name,
    in: where,
    required: where === 'path' ? true : required.has(name),
    schema: asRecord(propSchema) ?? {},
  }))
}

function toRequestBody(
  route: H3DuxOpenAPIRoute,
  body: BodyValidation,
  schema: (value: StandardTypedV1, context: MapSchemaContext) => JSONSchemaDocument | undefined,
): OpenAPIRequestBody {
  const content: Record<string, OpenAPIMediaType> = {}
  if (isSchema(body)) {
    content['application/json'] = {
      schema: schema(body, { direction: 'input', source: 'body', route: route.route, method: route.method }),
    }
  }
  else {
    for (const [mediaType, item] of Object.entries(body)) {
      content[mediaType] = {
        schema: schema(item, { direction: 'input', source: 'body', route: route.route, method: route.method }),
      }
    }
  }
  return { required: true, content }
}

function toResponses(
  route: H3DuxOpenAPIRoute,
  schema: (value: StandardTypedV1, context: MapSchemaContext) => JSONSchemaDocument | undefined,
): Record<string, OpenAPIResponse> {
  const out: Record<string, OpenAPIResponse> = {}
  const success = String(route.status ?? 200)
  const response = route.validate?.response

  if (response) {
    if (isSchema(response) || isTextResponse(response) || isBinaryResponse(response) || isEventStream(response)) {
      out[success] = responseObject(success, response, route, schema)
    }
    else {
      for (const [status, item] of Object.entries(response))
        out[status] = responseObject(status, item, route, schema)
    }
  }
  else {
    out[success] = { description: describeStatus(success) }
  }

  for (const [status, item] of Object.entries(route.errors ?? {}))
    out[status] = responseObject(status, item, route, schema, true)

  if (hasRequestValidation(route) && !out['422'])
    out['422'] = validationResponse()

  return out
}

function responseObject(
  status: string,
  value: unknown,
  route: H3DuxOpenAPIRoute,
  schema: (value: StandardTypedV1, context: MapSchemaContext) => JSONSchemaDocument | undefined,
  errorEnvelope = false,
): OpenAPIResponse {
  if (isEventStream(value)) {
    return {
      description: describeStatus(status),
      content: {
        'text/event-stream': {
          schema: schema(value as StandardTypedV1, { direction: 'output', source: 'response', route: route.route, method: route.method, status }),
        },
      },
    }
  }
  if (isTextResponse(value))
    return { description: describeStatus(status), content: { 'text/plain': { schema: { type: 'string' } } } }
  if (isBinaryResponse(value))
    return { description: describeStatus(status), content: { 'application/octet-stream': {} } }

  const bodySchema = isSchema(value)
    ? schema(value, { direction: 'output', source: 'response', route: route.route, method: route.method, status })
    : undefined
  return {
    description: describeStatus(status),
    content: {
      'application/json': {
        schema: errorEnvelope ? httpErrorSchema(Number(status), bodySchema) : bodySchema,
      },
    },
  }
}

function hasRequestValidation(route: H3DuxOpenAPIRoute): boolean {
  return !!(route.params || route.validate?.query || route.validate?.headers || route.validate?.body)
}

function validationResponse(): OpenAPIResponse {
  return {
    description: 'Unprocessable Entity',
    content: {
      'application/json': {
        schema: httpErrorSchema(422, {
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['params', 'query', 'headers', 'body'] },
            issues: { type: 'array', items: {} },
          },
          required: ['source', 'issues'],
        }),
      },
    },
  }
}

function httpErrorSchema(status: number, data: JSONSchemaDocument | undefined): JSONSchemaDocument {
  return {
    type: 'object',
    properties: {
      status: { type: 'integer', const: status },
      statusText: { type: 'string' },
      message: { type: 'string' },
      data: data ?? {},
    },
    required: ['status', 'statusText', 'message'],
  }
}

function applyOperationMeta(operation: OpenAPIOperation, meta: H3DuxOpenAPIObject | undefined): void {
  if (!meta)
    return
  for (const key of ['summary', 'description', 'operationId', 'tags', 'deprecated', 'security', 'externalDocs'] as const) {
    const value = meta[key]
    if (value !== undefined) {
      ;(operation as Record<string, unknown>)[key] = value
    }
  }
}

export function toOpenAPIPath(route: string): string {
  return route.replace(/\*\*:(\w+)/g, '{$1}').replace(/:(\w+)/g, '{$1}')
}

function describeStatus(code: StatusCodeKey): string {
  const n = typeof code === 'number' ? code : Number(code)
  const text: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    415: 'Unsupported Media Type',
    422: 'Unprocessable Entity',
    500: 'Internal Server Error',
  }
  return text[n] ?? 'Response'
}

function isSchema(value: unknown): value is SchemaWithJSON {
  return typeof value === 'object' && value !== null && '~standard' in value
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

// Local JSON Schema extraction helper for Standard Schema implementations.
function hasJSONSchema<T extends StandardTypedV1>(
  schema: T,
): schema is T & StandardJSONSchemaV1<unknown, unknown> {
  return 'jsonSchema' in schema['~standard']
}

function getStandardJSONSchema(
  value: StandardTypedV1,
  options: { direction: 'input' | 'output' },
): JSONSchemaDocument | undefined {
  if (!hasJSONSchema(value))
    return undefined
  try {
    return value['~standard'].jsonSchema[options.direction]({
      target: 'draft-2020-12',
      libraryOptions: { unrepresentable: 'any' },
    })
  }
  catch {
    return undefined
  }
}

// Local component extraction helper for `$id`-bearing schemas.
function extractComponents(jsonSchema: JSONSchemaDocument, existing: ComponentsRegistry): {
  schema: JSONSchemaDocument
  components: ComponentsRegistry
} {
  const components: ComponentsRegistry = { ...existing }
  const schema = walkSchema(jsonSchema, components) as JSONSchemaDocument
  return { schema, components }
}

function walkSchema(node: unknown, components: ComponentsRegistry): unknown {
  if (Array.isArray(node))
    return node.map(item => walkSchema(item, components))
  const record = asRecord(node)
  if (!record)
    return node
  const id = typeof record.$id === 'string' ? record.$id : undefined
  if (id) {
    if (!components[id])
      components[id] = walkChildren(record, components)
    return { $ref: `#/components/schemas/${id}` }
  }
  return walkChildren(record, components)
}

function walkChildren(node: Record<string, unknown>, components: ComponentsRegistry): JSONSchemaDocument {
  const out: JSONSchemaDocument = {}
  for (const [key, value] of Object.entries(node))
    out[key] = walkSchema(value, components)
  return out
}
