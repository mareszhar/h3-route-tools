import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import type { JSONSchemaDocument } from "../internal/types.ts";

/** Override a schema's emitted JSON Schema: a value replaces it, a fn patches the auto emission. */
export type JSONSchemaOverride =
  | JSONSchemaDocument
  | ((auto: JSONSchemaDocument) => JSONSchemaDocument);

/** Options for {@link defineSchema}. */
export interface DefineSchemaOptions {
  /** Emit `$id: id` so `extractComponents` lifts the schema into `components.schemas` (inner `$id` wins). */
  id?: string;
  /** Override the emitted JSON Schema (both directions). Value replaces; fn receives the auto emission. */
  jsonSchema?: JSONSchemaOverride;
}

/**
 * Decorate a schema's emitted JSON Schema; runtime validation passes through untouched.
 * Wraps at the standard-schema boundary, so it applies to the whole slot (body/response/params/…),
 * not a nested field — reach a nested field with the schema library's own metadata (zod `.meta()`)
 * or by patching the assembled slot via the `jsonSchema` fn.
 * Accepts a schema with no native JSON Schema (bare valibot) when `jsonSchema` is given — the override
 * supplies the emission from `{}`.
 *
 * defineSchema(z.date(), { jsonSchema: { type: "string", format: "date-time" } })
 * defineSchema(User, { id: "User" })
 * defineSchema(Post, { jsonSchema: (auto) => ({ ...auto, properties: { ...auto.properties, at: { type: "string" } } }) })
 */
export function defineSchema<I, O>(
  schema: StandardSchemaV1<I, O>,
  options: DefineSchemaOptions = {},
): StandardSchemaV1<I, O> & StandardJSONSchemaV1<I, O> {
  const inner = schema["~standard"];
  const innerJSON = (inner as Partial<StandardJSONSchemaV1<I, O>["~standard"]>).jsonSchema;
  const { id, jsonSchema } = options;

  const emit =
    (direction: "input" | "output") =>
    (opts: StandardJSONSchemaV1.Options): JSONSchemaDocument => {
      const auto = innerJSON ? innerJSON[direction](opts) : {};
      const out =
        jsonSchema === undefined
          ? auto
          : typeof jsonSchema === "function"
            ? jsonSchema(auto)
            : jsonSchema;
      return id && typeof out["$id"] !== "string" ? { $id: id, ...out } : out;
    };

  return {
    "~standard": {
      version: inner.version,
      vendor: inner.vendor,
      types: inner.types,
      validate: inner.validate,
      jsonSchema: { input: emit("input"), output: emit("output") },
    },
  };
}
