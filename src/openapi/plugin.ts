import type { H3, H3Plugin } from "h3";

import { attachRegistry, harvestRoutes } from "./registry.ts";
import {
  applyDocumentHook,
  buildOpenAPIDocument,
  type ErrorResponsesOption,
  type OpenAPIDocumentHook,
  type OpenAPIInfo,
} from "./document.ts";

/** Options for the OpenAPI plugin. `info` is required by the OpenAPI spec. */
export interface OpenAPIPluginOptions {
  info: OpenAPIInfo;
  /** Path the document is served from. Defaults to `/openapi.json`. */
  path?: string;
  /** Override or disable the auto-registered error responses (400, 415, 500) for every route. */
  errors?: ErrorResponsesOption;
  /** Customize the built document — a full-replace value, or a `(doc, ctx) => doc` transform. */
  document?: OpenAPIDocumentHook;
}

/**
 * H3 plugin that records the OpenAPI config on the app and serves the generated document.
 * The document is built per request by harvesting the app's routes (order-independent), then passed
 * through the optional `document` hook.
 *
 * @example
 * app.register(defineOpenAPI({
 *   info: { title: "API", version: "1.0.0" },
 *   document: (doc) => ({ ...doc, servers: [{ url: "https://api.example.com" }] }),
 * }))
 */
export function defineOpenAPI(options: OpenAPIPluginOptions): H3Plugin {
  if (!options.info?.title || !options.info?.version) {
    throw new TypeError("defineOpenAPI requires `info.title` and `info.version`.");
  }
  const path = options.path ?? "/openapi.json";

  return (h3: H3) => {
    attachRegistry(h3, {
      info: options.info,
      path,
      errors: options.errors,
      document: options.document,
    });

    h3.get(path, () => {
      const routes = harvestRoutes(h3);
      const doc = buildOpenAPIDocument({ info: options.info, routes, errors: options.errors });
      return applyDocumentHook(doc, options.document, routes);
    });
  };
}
