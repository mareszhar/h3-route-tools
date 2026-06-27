// ── the dux surface (counterpart-named; see docs/dux-language.md) ───────────
export { createClient, createTestClient } from './client.ts'

export type { Client, CreateClientOptions, H3DuxClientTransportOptions, VerbFetch } from './client.ts'
export { H3DuxHTTPError, H3DuxTransportError } from './errors.ts'
export type { H3DuxError } from './errors.ts'
export { createFileRouteFactory, defineFileRoute } from './file-route.ts'
export type {
  AsMethod,
  AssertFileRoute,
  Expect,
  FileFlatContract,
  FileMethods,
  FileRouteDefiner,
  FileRouteFactory,
  FlatContract,
  FlatSource,
  H3DuxFileHandler,
  NitroDataOf,
  ResolveFileParams,
  WithFilenameParams,
} from './file-route.ts'
// ── owned h3 baseline ─────────────────────────────────────────────────────────
// h3-dux keeps the useful low-level route primitives local so the package is
// dependency-free beyond h3 itself. The delightful path is still createServer /
// createClient; these exports are the escape hatches and type utilities those
// surfaces build on.
export { H3DuxApp } from './h3-app.ts'
export type { H3DuxAppConfig } from './h3-app.ts'
export type { EndpointContract, ResponseKind } from './internal/contract.ts'
export type { H3DuxEvent } from './internal/route-types.ts'
export type {
  BodyValidation,
  InferInput,
  InferOutput,
  JSONSchemaDocument,
  OnValidationError,
  SchemaWithJSON,
  ValidateSource,
} from './internal/schema-types.ts'
export { defineMiddleware } from './middleware.ts'
export type {
  BindingsOf,
  BoundEvent,
  MiddlewareSpec,
  TypedMiddleware,
} from './middleware.ts'
export { buildOpenAPI, toOpenAPI } from './openapi.ts'
export type { H3DuxOpenAPIDocument, ToOpenAPIOptions } from './openapi.ts'
export {
  binary,
  type BinaryResponse,
  type H3DuxRawResponse,
  text,
  type TextResponse,
  type TypedNativeResponse,
  typedResponse,
} from './response.ts'
export {
  defineRoute,
  defineRouteHandler,
  mountRouteHandler,
} from './route.ts'
export type {
  BodylessMethod,
  CallableMethod,
  DocumentableMethodDef,
  DocumentableRouteDef,
  DocumentableRouteHandler,
  Endpoint,
  ErrorResponsesOption,
  MethodStream,
  MethodValidate,
  MountableRouteHandler,
  ResponseStreamMap,
  ResponseValidation,
  RouteHandler,
  RouteHandlerDef,
  RouteHandlerOptions,
  RouteMethod,
  RoutePlugin,
  RouteRecord,
  StatusCodeKey,
} from './route.ts'
export { createRouter } from './router.ts'
export type { H3DuxRouter } from './router.ts'
export { mountRoutes } from './routes.ts'
export type { AnyRouteHandler, InferMethods, InferRoutes, RouteMap } from './routes.ts'
export { createServer, H3DuxServer } from './server.ts'
export { type EventStream, sse } from './sse.ts'
export { createTypedFetch } from './typed-fetch.ts'
export type { CreateTypedFetchOptions, FetchLike, NormalizeRoutes, TypedFetch, TypedResponse } from './typed-fetch.ts'
