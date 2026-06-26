// ── the dux surface (counterpart-named; see docs/dux-conventions.md) ───────────
export { createClient, createTestClient } from './client.ts'

export type { Client, VerbFetch } from './client.ts'
export { DuxHTTPError, DuxTransportError } from './errors.ts'
export type { DuxError } from './errors.ts'
export { createFileRouteFactory, defineFileRoute } from './file-route.ts'
export type {
  AsMethod,
  AssertFileRoute,
  DuxFileHandler,
  Expect,
  FileFlatContract,
  FileMethods,
  FileRouteDefiner,
  FileRouteFactory,
  FlatContract,
  FlatSource,
  ResolveFileParams,
  WithFilenameParams,
} from './file-route.ts'
export type { EndpointContract, ResponseKind } from './internal/contract.ts'
export { defineMiddleware } from './middleware.ts'
export type {
  BindingsOf,
  BoundEvent,
  MiddlewareSpec,
  TypedMiddleware,
} from './middleware.ts'
export {
  binary,
  type BinaryResponse,
  type DuxRawResponse,
  text,
  type TextResponse,
  type TypedNativeResponse,
  typedResponse,
} from './response.ts'
export { createRouter } from './router.ts'
export type { DuxRouter } from './router.ts'
export { createServer, DuxServer } from './server.ts'
export { type EventStream, sse } from './sse.ts'
// ── upstream surface ──────────────────────────────────────────────────────────
// h3-dux is a superset of h3-route-tools: everything upstream exports is
// available here unchanged, so tracking upstream stays a re-export, not a rewrite.
export * from 'h3-route-tools'
