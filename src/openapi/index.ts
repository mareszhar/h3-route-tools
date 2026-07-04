export { defineOpenAPI } from "./plugin.ts";
export type { OpenAPIPluginOptions } from "./plugin.ts";

export { buildOpenAPIDocument } from "./document.ts";
export type {
  OpenAPIDocument,
  OpenAPIInfo,
  OpenAPIOperation,
  OpenAPIPathItem,
  OpenAPIParameter,
  OpenAPIMediaType,
  OpenAPIRequestBody,
  OpenAPIResponse,
  OpenAPIComponents,
  OpenAPIVersion,
  RegisteredRoute,
  ErrorResponsesOption,
  OpenAPIObject,
  OpenAPIDocumentHook,
  OpenAPIDocumentContext,
} from "./document.ts";

export {
  attachRegistry,
  getRegistry,
  getOpenAPIConfig,
  harvestRoutes,
  documentableFromValidated,
} from "./registry.ts";
export type { OpenAPIRegistry, OpenAPIConfig } from "./registry.ts";

export { getOpenAPIDocument } from "./generate.ts";

export {
  HTTPErrorSchema,
  ValidationErrorSchema,
  UnsupportedMediaTypeSchema,
} from "./error-schemas.ts";

export { defineSchema } from "./define-schema.ts";
export type { DefineSchemaOptions, JSONSchemaOverride } from "./define-schema.ts";

export { defineOperation } from "./define-operation.ts";
export type { OperationMeta } from "./define-operation.ts";

export type {
  DocumentableRouteHandler,
  DocumentableRouteDef,
  DocumentableMethodDef,
} from "../route-handler.ts";
export type { JSONSchemaDocument } from "../internal/types.ts";
