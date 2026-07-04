export {
  defineRouteHandler,
  defineValidatedHandler,
  defineRoute,
  mountRouteHandler,
} from "./route-handler.ts";
export type {
  RouteHandler,
  RouteHandlerDef,
  ValidatedHandler,
  ValidatedHandlerDef,
  RouteHandlerOptions,
  MountableRouteHandler,
  MethodValidate,
  MethodStream,
  ResponseValidation,
  ResponseStreamMap,
  RouteMethod,
  StatusCodeKey,
  RoutePlugin,
  RouteRecord,
  MethodsRecord,
  SingleMethodRecord,
  MethodEndpoint,
  Endpoint,
  CallableMethod,
  BodylessMethod,
} from "./route-handler.ts";

export { H3Typed } from "./h3-typed.ts";
export type { H3TypedConfig } from "./h3-typed.ts";

export { mountRoutes } from "./routes.ts";
export type { InferRoutes, InferMethods, RouteMap, AnyRouteHandler } from "./routes.ts";

export { createTypedFetch } from "./typed-fetch.ts";
export type {
  TypedFetch,
  TypedResponse,
  NormalizeRoutes,
  CreateTypedFetchOptions,
  FetchLike,
} from "./typed-fetch.ts";

export type {
  SchemaWithJSON,
  BodyValidation,
  MediaTypeMap,
  StreamDoc,
  StreamMap,
  OnValidationError,
  ValidationFailure,
  ValidateSource,
  InferInput,
  InferOutput,
  HTTPErrorPayload,
  ValidationErrorData,
  ValidationErrorPayload,
  UnsupportedMediaTypeData,
  UnsupportedMediaTypePayload,
} from "./internal/types.ts";
