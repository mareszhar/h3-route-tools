import * as v from "valibot";

const FiniteNumberSchema = v.pipe(v.number(), v.finite());

const NumericStringSchema = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty(),
  v.transform(Number),
  FiniteNumberSchema
);

/** Coerce a non-empty numeric string (or finite number) into a validated number. */
const NumericSchema = v.union([NumericStringSchema, FiniteNumberSchema]);

function numeric(...checks: v.GenericPipeAction<number, number>[]) {
  return v.pipe(NumericSchema, ...checks);
}

/** Sortable fields exposed by `GET /fruits`. */
export const FruitSortField = v.picklist(["name", "price", "ripeness"]);

/** A fruit as stored and returned by the API. */
export const FruitSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/, "Use a lowercase slug")),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(40)),
  emoji: v.pipe(v.string(), v.minLength(1), v.maxLength(8)),
  color: v.pipe(v.string(), v.minLength(1)),
  tags: v.array(v.pipe(v.string(), v.minLength(1))),
  pricePerKg: v.pipe(v.number(), v.minValue(0)),
  /** 0 = unripe · 100 = perfectly ripe. */
  ripeness: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
  stockKg: v.pipe(v.number(), v.minValue(0)),
});

/**
 * Body for `POST /fruits`. The id is slugified from the name and freshly
 * stocked fruit always starts unripe — both are set server-side.
 */
export const NewFruitSchema = v.omit(FruitSchema, ["id", "ripeness"]);

/** Body for `PATCH /fruits/:id` — every field optional. */
export const FruitPatchSchema = v.partial(v.omit(FruitSchema, ["id"]));

/** Query for `GET /fruits` — filtering, sorting and cursor pagination. */
export const FruitQuerySchema = v.object({
  search: v.optional(v.string()),
  tag: v.optional(v.string()),
  minRipeness: v.optional(numeric(v.minValue(0), v.maxValue(100))),
  sort: v.optional(FruitSortField, "name"),
  limit: v.optional(numeric(v.minValue(1), v.maxValue(100)), 20),
  cursor: v.optional(v.string()),
});

/** A single page of fruits plus an opaque cursor to the next page. */
export const FruitPageSchema = v.object({
  items: v.array(FruitSchema),
  nextCursor: v.nullable(v.string()),
});

/** Body for `POST /checkout`. */
export const CheckoutOrderSchema = v.object({
  items: v.pipe(
    v.array(
      v.object({
        id: v.string(),
        kg: v.pipe(v.number(), v.minValue(0.01)),
      })
    ),
    v.minLength(1, "Add at least one fruit to the basket")
  ),
});

/** Itemised receipt returned by a successful checkout. */
export const ReceiptSchema = v.object({
  lines: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      kg: v.number(),
      subtotal: v.number(),
    })
  ),
  total: v.number(),
  currency: v.literal("USD"),
});

/** A single Server-Sent ripeness tick from `GET /fruits/:id/ripen`. */
export const RipenTickSchema = v.object({
  id: v.string(),
  ripeness: v.number(),
  at: v.string(),
});

/** Liveness payload from `GET /health`. */
export const HealthSchema = v.object({
  status: v.literal("ripe"),
  at: v.string(),
});

/** Uniform error envelope returned for every non-2xx response. */
export const ErrorSchema = v.object({
  error: v.string(),
  message: v.string(),
});

export type Fruit = v.InferInput<typeof FruitSchema>;
export type NewFruit = v.InferInput<typeof NewFruitSchema>;
export type FruitPatch = v.InferInput<typeof FruitPatchSchema>;
export type FruitQuery = v.InferInput<typeof FruitQuerySchema>;
export type TransformedFruitQuery = v.InferOutput<typeof FruitQuerySchema>;
export type FruitPage = v.InferInput<typeof FruitPageSchema>;
export type CheckoutOrder = v.InferInput<typeof CheckoutOrderSchema>;
export type Receipt = v.InferInput<typeof ReceiptSchema>;
export type RipenTick = v.InferInput<typeof RipenTickSchema>;
export type HealthReport = v.InferInput<typeof HealthSchema>;
export type ErrorBody = v.InferInput<typeof ErrorSchema>;
