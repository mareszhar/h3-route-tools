import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as v from "valibot";

import { defineSchema } from "../src/openapi/define-schema.ts";
import { getStandardJSONSchema, hasJSONSchema, readSchemaId } from "../src/openapi/json-schema.ts";

describe("defineSchema — $id / components", () => {
  const User = z.object({ id: z.string(), name: z.string() });

  it("preserves validation behaviour", async () => {
    const named = defineSchema(User, { id: "User" });
    const ok = await named["~standard"].validate({ id: "a", name: "Alice" });
    expect(ok).toEqual({ issues: undefined, value: { id: "a", name: "Alice" } });
    const fail = await named["~standard"].validate({ id: 42, name: "Alice" });
    expect(fail.issues).toBeDefined();
  });

  it("preserves vendor and version of the wrapped schema", () => {
    const named = defineSchema(User, { id: "User" });
    expect(named["~standard"].vendor).toBe(User["~standard"].vendor);
    expect(named["~standard"].version).toBe(1);
  });

  it("emits StandardJSONSchemaV1 with the injected $id on output", () => {
    const named = defineSchema(User, { id: "User" });
    expect(hasJSONSchema(named)).toBe(true);
    expect(readSchemaId(getStandardJSONSchema(named))).toBe("User");
  });

  it("injects $id on input direction too", () => {
    const named = defineSchema(User, { id: "User" });
    expect(readSchemaId(getStandardJSONSchema(named, { direction: "input" }))).toBe("User");
  });

  it("preserves the rest of the emitted JSON Schema body", () => {
    const named = defineSchema(User, { id: "User" });
    expect(getStandardJSONSchema(named)).toMatchObject({
      $id: "User",
      type: "object",
      properties: { id: expect.anything(), name: expect.anything() },
    });
  });

  it("does not override a pre-existing $id from the inner schema", () => {
    const Tagged = z.object({ id: z.string() }).meta({ $id: "PreSet" });
    const named = defineSchema(Tagged, { id: "Other" });
    expect(readSchemaId(getStandardJSONSchema(named))).toBe("PreSet");
  });

  it("is a no-op emission passthrough with no options", () => {
    const plain = defineSchema(User);
    expect(getStandardJSONSchema(plain)).toMatchObject({ type: "object" });
    expect(readSchemaId(getStandardJSONSchema(plain))).toBeUndefined();
  });
});

describe("defineSchema — jsonSchema override", () => {
  it("replaces the emitted schema with a value override", () => {
    const wrapped = defineSchema(z.date(), { jsonSchema: { type: "string", format: "date-time" } });
    expect(getStandardJSONSchema(wrapped)).toMatchObject({ type: "string", format: "date-time" });
  });

  it("patches the auto emission with a fn override (fixes a nested field)", () => {
    const Post = z.object({ id: z.number(), createdAt: z.date() });
    const wrapped = defineSchema(Post, {
      jsonSchema: (auto) => ({
        ...auto,
        properties: {
          ...(auto.properties as Record<string, unknown>),
          createdAt: { type: "string", format: "date-time" },
        },
      }),
    });
    expect(getStandardJSONSchema(wrapped)).toMatchObject({
      type: "object",
      properties: { id: { type: "number" }, createdAt: { type: "string", format: "date-time" } },
    });
  });

  it("injects $id alongside an override unless the override sets one", () => {
    const wrapped = defineSchema(z.date(), {
      id: "Timestamp",
      jsonSchema: { type: "string", format: "date-time" },
    });
    expect(getStandardJSONSchema(wrapped)).toMatchObject({ $id: "Timestamp", type: "string" });
  });

  it("passes validation through even with an override", async () => {
    const wrapped = defineSchema(z.date(), { jsonSchema: { type: "string" } });
    expect((await wrapped["~standard"].validate(new Date())).issues).toBeUndefined();
    expect((await wrapped["~standard"].validate("not a date")).issues).toBeDefined();
  });

  it("supplies JSON Schema for a schema that natively emits none (bare valibot)", () => {
    const bare = v.date();
    expect(hasJSONSchema(bare)).toBe(false);
    const wrapped = defineSchema(bare, { jsonSchema: { type: "string", format: "date-time" } });
    expect(hasJSONSchema(wrapped)).toBe(true);
    expect(getStandardJSONSchema(wrapped)).toEqual({ type: "string", format: "date-time" });
  });
});
