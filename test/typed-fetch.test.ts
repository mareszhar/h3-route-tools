import { describe, it, expect, expectTypeOf } from "vitest";
import { z } from "zod";

import { H3Typed } from "../src/h3-typed.ts";
import { defineRoute } from "../src/route-handler.ts";
import { createTypedFetch, type TypedFetch, type TypedResponse } from "../src/typed-fetch.ts";

// Type assertions run inside never-invoked thunks (calling the stub fetch would throw); a typecheck
// pass is the assertion. Runtime behaviour is covered by wrapping a real app's `request` as transport.

const posts = defineRoute({
  route: "/posts/:id",
  params: z.object({ id: z.coerce.number() }),
  get: {
    validate: { response: z.object({ id: z.number(), title: z.string() }) },
    handler: () => ({ id: 1, title: "hello" }),
  },
  post: {
    validate: {
      query: z.object({ draft: z.coerce.boolean() }),
      body: z.object({ title: z.string(), tags: z.string().transform((s) => s.split(",")) }),
      response: z.object({ id: z.number() }),
    },
    handler: async (event) => {
      const body = await event.req.json();
      return { id: body.tags.length };
    },
  },
});
const health = defineRoute({ route: "/health", get: { handler: () => ({ ok: true }) } });

const app = new H3Typed().register(posts).register(health);

// A code-gen-style already-resolved routes type (not an app/plugin) — the separate-consumer source.
type CodegenRoutes = {
  "/posts/:id": {
    get: {
      params: { id: number };
      query: never;
      headers: never;
      body: unknown;
      response: { id: number; title: string };
    };
    post: {
      params: { id: number };
      query: { draft: boolean };
      headers: never;
      body: { title: string; tags: string };
      response: { id: number };
    };
  };
};

describe("TypedFetch — typing over an H3Typed app source", () => {
  it("types the GET response and requires params for a parametric route", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      const res = await api("/posts/:id", { method: "get", params: { id: 1 } });
      expectTypeOf(res).toExtend<TypedResponse<{ id: number; title: string }>>();
      expectTypeOf(res.json()).resolves.toEqualTypeOf<{ id: number; title: string }>();
      expectTypeOf(res.status).toEqualTypeOf<number>();
    };
    void check;
  });

  it("types the POST body as schema INPUT, plus query, plus response", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      const res = await api("/posts/:id", {
        method: "post",
        params: { id: 1 },
        query: { draft: true },
        body: { title: "t", tags: "a,b" },
      });
      expectTypeOf(res.json()).resolves.toEqualTypeOf<{ id: number }>();
    };
    void check;
  });

  // oxlint-disable-next-line vitest/expect-expect
  it("accepts the method in either case", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      await api("/posts/:id", { method: "get", params: { id: 1 } });
      await api("/posts/:id", { method: "GET", params: { id: 1 } });
      await api("/posts/:id", {
        method: "POST",
        params: { id: 1 },
        body: { title: "t", tags: "a" },
      });
    };
    void check;
  });

  it("does not require params for a static route; an unvalidated response stays unknown", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      // no response schema → unknown (only validated responses are typed)
      const res = await api("/health", { method: "get" });
      expectTypeOf(res.json()).resolves.toBeUnknown();
    };
    void check;
  });

  // oxlint-disable-next-line vitest/expect-expect
  it("rejects an unknown route and an undeclared method", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      // @ts-expect-error — /nope is not a route
      await api("/nope", { method: "get" });
      // @ts-expect-error — delete is not declared on /posts/:id
      await api("/posts/:id", { method: "delete", params: { id: 1 } });
    };
    void check;
  });

  // oxlint-disable-next-line vitest/expect-expect
  it("rejects a body on GET (RFC) and any excess option key", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      // @ts-expect-error — GET takes no body
      await api("/posts/:id", { method: "get", params: { id: 1 }, body: { x: 1 } });
      // @ts-expect-error — `nope` is not a known option
      await api("/posts/:id", { method: "get", params: { id: 1 }, nope: true });
    };
    void check;
  });

  // oxlint-disable-next-line vitest/expect-expect
  it("rejects a mistyped body field", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      await api("/posts/:id", {
        method: "post",
        params: { id: 1 },
        // @ts-expect-error — title must be a string
        body: { title: 42, tags: "a" },
      });
    };
    void check;
  });
});

describe("TypedFetch — typing over an already-resolved (code-gen) source", () => {
  it("addresses + types identically to the app-derived client", () => {
    const check = async (api: TypedFetch<CodegenRoutes>) => {
      const res = await api("/posts/:id", {
        method: "POST",
        params: { id: 1 },
        body: { title: "t", tags: "a" },
      });
      expectTypeOf(res.json()).resolves.toEqualTypeOf<{ id: number }>();
    };
    void check;
  });
});

describe("TypedFetch — response is typed as the wire shape, not the pre-serialize shape", () => {
  const dated = defineRoute({
    route: "/events/:id",
    params: z.object({ id: z.coerce.number() }),
    get: {
      validate: { response: z.object({ id: z.number(), when: z.date() }) },
      handler: () => ({ id: 1, when: new Date(0) }),
    },
  });
  const datedApp = new H3Typed().register(dated);

  it("types a Date response field as string (matches Response.json())", () => {
    const check = async (api: TypedFetch<typeof datedApp>) => {
      const res = await api("/events/:id", { method: "get", params: { id: 1 } });
      // `when` is `z.date()` (a Date pre-serialization) but arrives as a string over the wire.
      expectTypeOf(res.json()).resolves.toEqualTypeOf<{ id: number; when: string }>();
    };
    void check;
  });

  it("the runtime value agrees: res.json().when is a string", async () => {
    const api = createTypedFetch<typeof datedApp>({ fetch: datedApp.request });
    const data = await api("/events/:id", { method: "get", params: { id: 1 } }).then((r) =>
      r.json(),
    );
    expect(typeof data.when).toBe("string");
    expect(data).toEqual({ id: 1, when: "1970-01-01T00:00:00.000Z" });
  });
});

describe("createTypedFetch — runtime over a real app's request", () => {
  const api = createTypedFetch<typeof app>({ fetch: app.request });

  it("substitutes params into the pattern and types + returns the GET response", async () => {
    const res = await api("/posts/:id", { method: "get", params: { id: 1 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, title: "hello" });
  });

  it("upcases the method, appends query, and JSON-encodes the body", async () => {
    const res = await api("/posts/:id", {
      method: "post",
      params: { id: 1 },
      query: { draft: true },
      body: { title: "t", tags: "a,b,c" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 3 });
  });

  it("applies baseURL and serves a static route", async () => {
    const prefixed = createTypedFetch<typeof app>({
      baseURL: "",
      fetch: (url, init) => app.request(url, init),
    });
    const res = await prefixed("/health", { method: "GET" });
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("createTypedFetch — request serialization round-trips through a real app", () => {
  const echo = defineRoute({
    route: "/echo/:id",
    params: z.object({ id: z.coerce.number() }),
    get: {
      validate: {
        query: z.object({
          s: z.string().optional(),
          n: z.coerce.number().optional(),
          flag: z.coerce.boolean().optional(),
          since: z.coerce.date().optional(),
          tags: z.array(z.string()).optional(),
          ids: z.array(z.coerce.number()).optional(),
        }),
      },
      handler: (event) => ({ id: event.context.params.id, query: event.context.query }),
    },
  });
  const echoApp = new H3Typed().register(echo);
  const api = createTypedFetch<typeof echoApp>({ fetch: echoApp.request });
  const read = (res: TypedResponse<unknown>) =>
    res.json() as Promise<{ id: number; query: Record<string, unknown> }>;

  it("coerces a numeric path param", async () => {
    const res = await api("/echo/:id", { method: "get", params: { id: 42 } });
    expect((await read(res)).id).toBe(42);
  });

  it("round-trips scalars (string, number, boolean)", async () => {
    const res = await api("/echo/:id", {
      method: "get",
      params: { id: 1 },
      query: { s: "a b", n: 5, flag: true },
    });
    expect((await read(res)).query).toEqual({ s: "a b", n: 5, flag: true });
  });

  it("round-trips a Date as bare ISO into coerce.date", async () => {
    const res = await api("/echo/:id", {
      method: "get",
      params: { id: 1 },
      query: { since: new Date("2026-07-04T00:00:00.000Z") },
    });
    expect((await read(res)).query.since).toBe("2026-07-04T00:00:00.000Z");
  });

  it("round-trips arrays as repeated params", async () => {
    const res = await api("/echo/:id", {
      method: "get",
      params: { id: 1 },
      query: { tags: ["a", "b"], ids: [1, 2] },
    });
    expect((await read(res)).query).toEqual({ tags: ["a", "b"], ids: [1, 2] });
  });

  it("omits an undefined query value and an empty array", async () => {
    const res = await api("/echo/:id", {
      method: "get",
      params: { id: 1 },
      query: { s: undefined, tags: [] },
    });
    expect((await read(res)).query).toEqual({});
  });

  it("throws a TypeError on a non-serializable object value", async () => {
    const call = api("/echo/:id", {
      method: "get",
      params: { id: 1 },
      query: { s: { nested: true } as unknown as string },
    });
    await expect(call).rejects.toThrow(TypeError);
  });
});
