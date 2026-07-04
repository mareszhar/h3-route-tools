import type { OpenAPIObject, OpenAPIOperation } from "./document.ts";

/**
 * An OpenAPI operation fragment for a route/method `meta.openapi`; open for spec fields the library
 * doesn't model (`security`, `servers`, `x-*`). The builder shallow-merges it over the auto operation.
 */
export type OperationMeta = OpenAPIObject<Partial<OpenAPIOperation>>;

/**
 * Typed identity for an operation fragment — assign the result to a route/method `meta.openapi`.
 *
 * meta: { openapi: defineOperation({ summary: "List posts", tags: ["posts"] }) }
 */
export function defineOperation(operation: OperationMeta): OperationMeta {
  return operation;
}
