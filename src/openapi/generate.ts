import type { H3 } from "h3";

import { getOpenAPIConfig, harvestRoutes } from "./registry.ts";
import { applyDocumentHook, buildOpenAPIDocument, type OpenAPIDocument } from "./document.ts";

/**
 * Build the OpenAPI document from a configured app — its stamped `info`/`errors`/`document` plus its
 * harvested routes. Pure (no I/O); `JSON.stringify` the result to emit a static file.
 *
 * @returns the document, or `undefined` if the app has no OpenAPI config.
 *
 * @example
 * const doc = getOpenAPIDocument(app)
 */
export function getOpenAPIDocument(app: H3): OpenAPIDocument | undefined {
  const config = getOpenAPIConfig(app);
  if (!config) return undefined;
  const routes = harvestRoutes(app);
  const doc = buildOpenAPIDocument({ info: config.info, routes, errors: config.errors });
  return applyDocumentHook(doc, config.document, routes);
}
