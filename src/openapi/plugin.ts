import type { H3, H3Plugin } from "h3";

import { attachRegistry, getRouteTable, harvestRoutes } from "./registry.ts";
import {
  applyDocumentHook,
  buildOpenAPIDocument,
  type ErrorResponsesOption,
  type OpenAPIDocument,
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
 * The document is generated from the app's routes (order-independent) and memoized until the route
 * set changes, then passed through the optional `document` hook.
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

    // The doc is a pure function of the (fixed) config and the route set, so memoize it and rebuild
    // only when the route table changes — the expensive schema→JSON-Schema pass runs once, not per request.
    let cache: { routes: readonly unknown[]; doc: OpenAPIDocument } | undefined;

    h3.get(path, () => {
      const table = getRouteTable(h3);
      if (cache && sameRoutes(cache.routes, table)) return cache.doc;

      const routes = harvestRoutes(h3);
      const doc = applyDocumentHook(
        buildOpenAPIDocument({ info: options.info, routes, errors: options.errors }),
        options.document,
        routes,
      );
      cache = { routes: table.slice(), doc };
      return doc;
    });
  };
}

/** Element-wise identity equality — the route table only grows/shrinks, so refs never change in place. */
function sameRoutes(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
