import type { H3 } from "h3";

import type {
  DocumentableRouteDef,
  DocumentableRouteHandler,
  RouteMethod,
  ValidatedHandler,
} from "../route-handler.ts";
import type {
  ErrorResponsesOption,
  OpenAPIDocumentHook,
  OpenAPIInfo,
  RegisteredRoute,
} from "./document.ts";

export type { RegisteredRoute } from "./document.ts";

/** h3's internal route table; the single point of coupling for {@link harvestRoutes}. */
const ROUTES_KEY = "~routes";
/** Our OpenAPI config stamp on an H3 instance. */
const OPENAPI_KEY = "~openapi";

/** OpenAPI config stamped onto an H3 instance — the doc metadata that routes can't supply. */
export interface OpenAPIConfig {
  info: OpenAPIInfo;
  path?: string;
  errors?: ErrorResponsesOption;
  document?: OpenAPIDocumentHook;
}

/** A read view of an app's OpenAPI state: its configured info plus the routes harvested from h3. */
export interface OpenAPIRegistry {
  info: OpenAPIInfo;
  routes: RegisteredRoute[];
}

/** Stamp the OpenAPI config onto an H3 instance, read back by {@link getRegistry}/{@link getOpenAPIConfig}. */
export function attachRegistry(h3: H3, config: OpenAPIConfig): void {
  Reflect.set(h3, OPENAPI_KEY, config);
}

/** Read the OpenAPI config stamped on an H3 instance, if docs were configured for it. */
export function getOpenAPIConfig(h3: H3): OpenAPIConfig | undefined {
  const config = Reflect.get(h3, OPENAPI_KEY);
  return isOpenAPIConfig(config) ? config : undefined;
}

/**
 * The OpenAPI registry view for an app: its stamped `info` plus its currently-registered routes.
 * Routes are harvested from h3 on each call, so registration order never matters.
 */
export function getRegistry(h3: H3): OpenAPIRegistry | undefined {
  const config = getOpenAPIConfig(h3);
  return config ? { info: config.info, routes: harvestRoutes(h3) } : undefined;
}

/**
 * Collect every documentable route on an H3 instance by reading h3's own route table:
 * - `~routeDef` handlers (`defineRoute`, `H3Typed.route`, raw `app.all(route, defineRouteHandler(...))`);
 * - `~validatedDef` handlers (`H3Typed.get`/`.post`/…), keyed by the entry's registration method.
 *
 * Sub-app routes (via `mount`) appear with their base prefix.
 */
export function harvestRoutes(h3: H3): RegisteredRoute[] {
  const routes = Reflect.get(h3, ROUTES_KEY);
  if (!Array.isArray(routes)) return [];
  const out: RegisteredRoute[] = [];
  // One `defineRoute` handler is registered under several methods (+ a catch-all), so it appears
  // multiple times in the table — dedupe by handler identity to document each route once.
  const seen = new Set<unknown>();
  for (const entry of routes) {
    if (typeof entry?.route !== "string" || seen.has(entry.handler)) continue;
    if (isDocumentable(entry.handler)) {
      seen.add(entry.handler);
      out.push({ route: entry.route, handler: entry.handler });
    } else if (isValidated(entry.handler)) {
      const method = normalizeMethod(entry.method);
      if (!method) continue; // method-agnostic mount (e.g. `app.all`) — no method to key on
      seen.add(entry.handler);
      out.push({ route: entry.route, handler: documentableFromValidated(entry.handler, method) });
    }
  }
  return out;
}

/**
 * The live route-table array on an H3 instance. Its entries are only pushed (or spliced by
 * `removeRoute`), so an element-wise identity snapshot of it is a faithful, cheap change key —
 * used to invalidate the served OpenAPI document memo.
 */
export function getRouteTable(h3: H3): readonly unknown[] {
  const routes = Reflect.get(h3, ROUTES_KEY);
  return Array.isArray(routes) ? routes : [];
}

function isDocumentable(handler: unknown): handler is DocumentableRouteHandler {
  return typeof handler === "function" && "~routeDef" in handler;
}

function isValidated(handler: unknown): handler is ValidatedHandler {
  return typeof handler === "function" && "~validatedDef" in handler;
}

/**
 * Project a {@link ValidatedHandler} (method-agnostic) into a single-method {@link DocumentableRouteHandler}
 * for OpenAPI — the `method` comes from the mount (an `H3Typed.get` call, a nitro filename).
 */
export function documentableFromValidated(
  handler: ValidatedHandler,
  method: RouteMethod,
): DocumentableRouteHandler {
  const def = handler["~validatedDef"];
  const routeDef: DocumentableRouteDef = { params: def.params, meta: def.meta };
  routeDef[method] = { validate: def.validate, stream: def.stream, meta: def.meta };
  return { "~routeDef": routeDef };
}

const HTTP_METHODS = new Set(["get", "head", "post", "put", "patch", "delete", "options"]);

function normalizeMethod(method: unknown): RouteMethod | undefined {
  const m = typeof method === "string" ? (method.toLowerCase() as RouteMethod) : undefined;
  return m && HTTP_METHODS.has(m) ? m : undefined;
}

function isOpenAPIConfig(value: unknown): value is OpenAPIConfig {
  return typeof value === "object" && value !== null && "info" in value;
}
