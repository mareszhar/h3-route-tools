import { describe, it, expect } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { H3 } from "h3";
import { z } from "zod";

import { H3Typed } from "../src/h3-typed.ts";
import { defineRoute } from "../src/route-handler.ts";
import { defineOpenAPI } from "../src/openapi/plugin.ts";
import { defineOperation } from "../src/openapi/define-operation.ts";
import { getOpenAPIDocument } from "../src/openapi/generate.ts";
import { writeOpenAPIDocument } from "../src/codegen.ts";

function configuredApp() {
  return new H3Typed({ openapi: { info: { title: "API", version: "1.0.0" } } }).route({
    route: "/posts/:id",
    params: z.object({ id: z.coerce.number() }),
    get: {
      validate: { response: z.object({ id: z.number(), title: z.string() }) },
      handler: () => ({ id: 1, title: "hello" }),
    },
  });
}

describe("getOpenAPIDocument", () => {
  it("builds a 3.1 document from a configured app's stamped config + harvested routes", () => {
    const doc = getOpenAPIDocument(configuredApp());
    expect(doc?.openapi).toBe("3.1.0");
    expect(doc?.info).toEqual({ title: "API", version: "1.0.0" });
    expect(Object.keys(doc?.paths ?? {})).toContain("/posts/{id}");
    expect(doc?.paths["/posts/{id}"]?.get).toBeDefined();
  });

  it("also reads config attached via the defineOpenAPI plugin on a plain H3", () => {
    const app = new H3();
    app.register(defineRoute({ route: "/health", get: { handler: () => ({ ok: true }) } }));
    app.register(defineOpenAPI({ info: { title: "T", version: "2.0.0" } }));
    const doc = getOpenAPIDocument(app);
    expect(doc?.info.version).toBe("2.0.0");
    expect(Object.keys(doc?.paths ?? {})).toContain("/health");
  });

  it("returns undefined when the app has no OpenAPI config", () => {
    const app = new H3();
    app.register(defineRoute({ route: "/x", get: { handler: () => "x" } }));
    expect(getOpenAPIDocument(app)).toBeUndefined();
  });

  it("is JSON-serializable for a build-time emit", () => {
    const json = JSON.stringify(getOpenAPIDocument(configuredApp()));
    expect(JSON.parse(json).openapi).toBe("3.1.0");
  });
});

describe("defineOpenAPI — document hook + global errors", () => {
  const routed = (openapi: ConstructorParameters<typeof H3Typed>[0]) =>
    new H3Typed(openapi).route({
      route: "/x",
      post: {
        validate: { body: z.object({ name: z.string() }), response: z.object({ ok: z.boolean() }) },
        handler: () => ({ ok: true }),
      },
    });

  it("applies a document transform callback (adds globals; routes still present)", () => {
    const app = routed({
      openapi: {
        info: { title: "API", version: "1.0.0" },
        document: (doc) => ({ ...doc, servers: [{ url: "https://api.example.com" }] }),
      },
    });
    const doc = getOpenAPIDocument(app);
    expect((doc as { servers?: unknown }).servers).toEqual([{ url: "https://api.example.com" }]);
    expect(doc?.paths["/x"]?.post).toBeDefined();
  });

  it("passes harvested routes + a jsonSchema helper to the callback", () => {
    let routeCount = -1;
    let hasHelper = false;
    const app = routed({
      openapi: {
        info: { title: "API", version: "1.0.0" },
        document: (doc, ctx) => {
          routeCount = ctx.routes.length;
          hasHelper = typeof ctx.jsonSchema === "function";
          return doc;
        },
      },
    });
    getOpenAPIDocument(app);
    expect(routeCount).toBe(1);
    expect(hasHelper).toBe(true);
  });

  it("replaces the whole document with a value hook", () => {
    const replacement = {
      openapi: "3.1.0" as const,
      info: { title: "R", version: "9" },
      paths: {},
    };
    const app = routed({
      openapi: { info: { title: "API", version: "1.0.0" }, document: replacement },
    });
    expect(getOpenAPIDocument(app)).toEqual(replacement);
  });

  it("opts out of auto error responses globally with `errors: false`", () => {
    const app = routed({ openapi: { info: { title: "API", version: "1.0.0" }, errors: false } });
    const post = getOpenAPIDocument(app)?.paths["/x"]?.post;
    expect(post?.responses?.["400"]).toBeUndefined();
    expect(post?.responses?.["500"]).toBeUndefined();
  });
});

describe("operation metadata via meta.openapi + defineOperation", () => {
  it("shallow-merges operation prose over the auto operation (auto pieces survive)", () => {
    const app = new H3Typed({ openapi: { info: { title: "API", version: "1.0.0" } } }).route({
      route: "/posts/:id",
      params: z.object({ id: z.coerce.number() }),
      get: {
        meta: {
          openapi: defineOperation({
            summary: "Get a post",
            tags: ["posts"],
            operationId: "getPost",
          }),
        },
        validate: { response: z.object({ id: z.number() }) },
        handler: () => ({ id: 1 }),
      },
    });
    const get = getOpenAPIDocument(app)?.paths["/posts/{id}"]?.get;
    expect(get?.summary).toBe("Get a post");
    expect(get?.tags).toEqual(["posts"]);
    expect(get?.operationId).toBe("getPost");
    expect(get?.responses?.["200"]).toBeDefined(); // validation-derived pieces survive the merge
    expect(get?.responses?.["500"]).toBeDefined();
  });

  it("replaces an auto field when meta.openapi spells it out", () => {
    const app = new H3Typed({ openapi: { info: { title: "API", version: "1.0.0" } } }).route({
      route: "/thing",
      get: {
        meta: { openapi: defineOperation({ responses: { "204": { description: "No Content" } } }) },
        validate: { response: z.object({ ok: z.boolean() }) },
        handler: () => ({ ok: true }),
      },
    });
    const get = getOpenAPIDocument(app)?.paths["/thing"]?.get;
    expect(get?.responses).toEqual({ "204": { description: "No Content" } });
  });
});

describe("writeOpenAPIDocument", () => {
  it("writes the document to disk and returns it", async () => {
    const path = `${tmpdir()}/h3tr-openapi.json`;
    try {
      const returned = await writeOpenAPIDocument(configuredApp(), path);
      const onDisk = JSON.parse(await readFile(path, "utf8"));
      expect(onDisk).toEqual(returned);
      expect(onDisk.openapi).toBe("3.1.0");
      expect(Object.keys(onDisk.paths)).toContain("/posts/{id}");
    } finally {
      await rm(path, { force: true });
    }
  });

  it("honors a custom indent (0 minifies)", async () => {
    const path = `${tmpdir()}/h3tr-openapi-min.json`;
    try {
      await writeOpenAPIDocument(configuredApp(), path, { indent: 0 });
      expect(await readFile(path, "utf8")).not.toContain("\n");
    } finally {
      await rm(path, { force: true });
    }
  });

  it("throws when the app has no OpenAPI config", async () => {
    await expect(writeOpenAPIDocument(new H3(), `${tmpdir()}/h3tr-nope.json`)).rejects.toThrow(
      /no OpenAPI config/
    );
  });
});
