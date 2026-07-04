import { describe, it, expect, expectTypeOf, beforeEach } from "vitest";
import { H3, type EventHandlerWithFetch } from "h3";
import { z } from "zod";

import { defineValidatedHandler } from "../src/route-handler.ts";

describe("defineValidatedHandler — input DX", () => {
  it("accepts a bare handler", () => {
    const h = defineValidatedHandler({ handler: () => "ok" });
    expectTypeOf(h).toExtend<EventHandlerWithFetch>();
  });

  it("accepts params + middleware + validate + meta + onValidationError", () => {
    const h = defineValidatedHandler({
      params: z.object({ id: z.coerce.number() }),
      middleware: [(_event, next) => next()],
      meta: { tags: ["x"] },
      onValidationError: () => ({ status: 422 }),
      validate: { query: z.object({ q: z.string() }), response: z.object({ id: z.number() }) },
      handler: (event) => ({ id: event.context.params.id }),
    });
    expectTypeOf(h).toExtend<EventHandlerWithFetch>();
  });
});

describe("defineValidatedHandler — handler event typing", () => {
  it("types context.{params,query,headers}, event.validated, and event.req.json()", () => {
    defineValidatedHandler({
      params: z.object({ id: z.coerce.number() }),
      validate: {
        query: z.object({ limit: z.coerce.number() }),
        headers: z.object({ "x-token": z.string() }),
        body: z.object({ name: z.string() }),
      },
      handler: async (event) => {
        expectTypeOf(event.context.params).toEqualTypeOf<{ id: number }>();
        expectTypeOf(event.context.query).toEqualTypeOf<{ limit: number }>();
        expectTypeOf(event.context.headers).toEqualTypeOf<{ "x-token": string }>();
        expectTypeOf(event.validated.query).toEqualTypeOf<{ limit: number }>();
        expectTypeOf(await event.req.json()).toEqualTypeOf<{ name: string }>();
        return null;
      },
    });
  });

  it("defaults context.params to Record<string, string> without a params schema", () => {
    defineValidatedHandler({
      handler: (event) => {
        expectTypeOf(event.context.params).toEqualTypeOf<Record<string, string>>();
        return null;
      },
    });
  });
});

describe("defineValidatedHandler — return stamp", () => {
  it("carries ~validatedDef, ~options, and a phantom ~inferEndpoint", () => {
    const h = defineValidatedHandler(
      {
        params: z.object({ id: z.coerce.number() }),
        validate: { response: z.object({ id: z.number() }) },
        handler: (event) => ({ id: event.context.params.id }),
      },
      { decode: true },
    );
    expect(h["~validatedDef"].handler).toBeTypeOf("function");
    expect(h["~options"].decode).toBe(true);

    type E = NonNullable<(typeof h)["~inferEndpoint"]>;
    expectTypeOf<E["params"]>().toEqualTypeOf<{ id: number }>();
    expectTypeOf<E["response"]>().toEqualTypeOf<{ id: number }>();
  });
});

describe("defineValidatedHandler — runtime", () => {
  let app: H3;
  beforeEach(() => {
    app = new H3();
  });

  it("validates + coerces params, exposing context and the validated view", async () => {
    app.get(
      "/items/:id",
      defineValidatedHandler({
        params: z.object({ id: z.coerce.number() }),
        handler: (event) => ({ ctx: event.context.params.id, bag: event.validated.params.id }),
      }),
    );
    expect(await (await app.request("/items/21")).json()).toEqual({ ctx: 21, bag: 21 });
    expect((await app.request("/items/abc")).status).toBe(400);
  });

  it("validates a JSON body lazily via event.req.json() (POST)", async () => {
    app.post(
      "/users",
      defineValidatedHandler({
        validate: { body: z.object({ name: z.string() }) },
        handler: async (event) => ({ received: (await event.req.json()).name }),
      }),
    );
    const ok = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    });
    expect(await ok.json()).toEqual({ received: "Ada" });

    const bad = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });
    expect(bad.status).toBe(400);
  });

  it("validates the response (500 on contract breach)", async () => {
    app.get(
      "/broken",
      defineValidatedHandler({
        validate: { response: z.object({ id: z.string() }) },
        // @ts-expect-error: deliberately wrong type to exercise the 500 path.
        handler: () => ({ id: 123 }),
      }),
    );
    expect((await app.request("/broken")).status).toBe(500);
  });

  it("runs middleware before validation (eager query validation stays inside the handler)", async () => {
    const calls: string[] = [];
    app.get(
      "/mw",
      defineValidatedHandler({
        middleware: [
          (_event, next) => {
            calls.push("mw");
            return next();
          },
        ],
        validate: { query: z.object({ limit: z.coerce.number() }) },
        handler: (event) => {
          calls.push("handler");
          return { limit: event.validated.query.limit };
        },
      }),
    );

    // Valid: middleware then handler.
    expect(await (await app.request("/mw?limit=5")).json()).toEqual({ limit: 5 });
    expect(calls).toEqual(["mw", "handler"]);

    // Invalid: middleware still ran, but eager query validation threw before the handler.
    calls.length = 0;
    expect((await app.request("/mw?limit=abc")).status).toBe(400);
    expect(calls).toEqual(["mw"]);
  });

  it("honours a custom onValidationError", async () => {
    app.post(
      "/custom",
      defineValidatedHandler({
        onValidationError: () => ({ status: 422, message: "Unprocessable" }),
        validate: { body: z.object({ name: z.string() }) },
        handler: async (event) => await event.req.json(),
      }),
    );
    const res = await app.request("/custom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });
    expect(res.status).toBe(422);
  });

  it("does not self-dispatch: an undeclared method 404s (h3 owns routing)", async () => {
    app.get("/single", defineValidatedHandler({ handler: () => "got" }));
    expect(await (await app.request("/single")).text()).toBe("got");
    // No app.all catch-all → h3 never routes POST here → 404, not a self-served 405.
    expect((await app.request("/single", { method: "POST" })).status).toBe(404);
  });
});
