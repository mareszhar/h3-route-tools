import { bench, describe } from "vitest";
import { z } from "zod";

import { H3Typed } from "../src/h3-typed.ts";
import { harvestRoutes } from "../src/openapi/registry.ts";
import { buildOpenAPIDocument } from "../src/openapi/document.ts";
import { getOpenAPIDocument } from "../src/openapi/generate.ts";

const info = { title: "Bench API", version: "1.0.0" };

/** An app with `n` routes, each carrying params + query/body/response schemas so the build has real work. */
function bigApp(n: number): H3Typed {
  const app = new H3Typed({ openapi: { info } });
  for (let i = 0; i < n; i++) {
    app.route({
      route: `/resource-${i}/:id`,
      params: z.object({ id: z.coerce.number() }),
      get: {
        validate: {
          query: z.object({ page: z.coerce.number().optional(), q: z.string().optional() }),
          response: z.object({ id: z.number(), name: z.string(), tags: z.array(z.string()) }),
        },
        handler: () => ({ id: 1, name: "x", tags: [] }),
      },
      post: {
        validate: {
          body: z.object({ name: z.string(), tags: z.array(z.string()) }),
          response: z.object({ id: z.number() }),
        },
        handler: () => ({ id: 1 }),
      },
    });
  }
  return app;
}

describe("openapi document (40 routes)", () => {
  const app = bigApp(40);
  const routes = harvestRoutes(app);

  // The expensive core: schema→JSON-Schema conversion for every slot on every route.
  bench("buildOpenAPIDocument (cold core)", () => {
    buildOpenAPIDocument({ info, routes });
  });

  // The pre-memo per-request cost: harvest + build + hook, every time.
  bench("getOpenAPIDocument (harvest + build)", () => {
    getOpenAPIDocument(app);
  });

  // The memoized serve — a route-table fingerprint compare + cache hit (also pays HTTP machinery,
  // so the real memo win over the pre-memo cost above is even larger than the gap shown here).
  bench("app.request('/openapi.json') (memoized serve)", async () => {
    await app.request("/openapi.json");
  });
});
