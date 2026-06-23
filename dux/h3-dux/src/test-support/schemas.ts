/**
 * The Orchard fixture — a small fruit-market API expressed as valibot schemas,
 * shared by every test plane (and mirrored, larger, in the demo). It exercises
 * the cases that matter for typing: coercion (`v.pipe(string, transform)`),
 * wire-vs-output divergence (none here, but the shapes are ready for it), and
 * nested objects.
 */
import * as v from 'valibot'

const numeric = v.union([
  v.pipe(v.string(), v.trim(), v.nonEmpty(), v.transform(Number), v.number(), v.finite()),
  v.pipe(v.number(), v.finite()),
])

/** A fruit as stored and returned by the API. */
export const FruitSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/, 'Use a lowercase slug')),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(40)),
  emoji: v.pipe(v.string(), v.minLength(1), v.maxLength(8)),
  color: v.pipe(v.string(), v.minLength(1)),
  tags: v.array(v.pipe(v.string(), v.minLength(1))),
  pricePerKg: v.pipe(v.number(), v.minValue(0)),
  /** 0 = unripe · 100 = perfectly ripe. */
  ripeness: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
  stockKg: v.pipe(v.number(), v.minValue(0)),
})

/** `POST /fruits` body — id is slugified and ripeness starts at 0, both server-side. */
export const NewFruitSchema = v.omit(FruitSchema, ['id', 'ripeness'])

/** `PATCH /fruits/:id` body — every field optional. */
export const FruitPatchSchema = v.partial(v.omit(FruitSchema, ['id']))

/** `GET /fruits` query — filtering, sorting, cursor pagination. */
export const FruitQuerySchema = v.object({
  search: v.optional(v.string()),
  tag: v.optional(v.string()),
  minRipeness: v.optional(v.pipe(numeric, v.minValue(0), v.maxValue(100))),
  sort: v.optional(v.picklist(['name', 'price', 'ripeness']), 'name'),
  limit: v.optional(v.pipe(numeric, v.minValue(1), v.maxValue(100)), 20),
  cursor: v.optional(v.string()),
})

/** A page of fruits plus an opaque cursor. */
export const FruitPageSchema = v.object({
  items: v.array(FruitSchema),
  nextCursor: v.nullable(v.string()),
})

/** `POST /checkout` body. */
export const CheckoutOrderSchema = v.object({
  items: v.pipe(
    v.array(v.object({ id: v.string(), kg: v.pipe(v.number(), v.minValue(0.01)) })),
    v.minLength(1, 'Add at least one fruit to the basket'),
  ),
})

/** Itemised receipt from a successful checkout. */
export const ReceiptSchema = v.object({
  lines: v.array(
    v.object({ id: v.string(), name: v.string(), kg: v.number(), subtotal: v.number() }),
  ),
  total: v.number(),
  currency: v.literal('USD'),
})

/** One Server-Sent ripeness tick from `GET /fruits/:id/ripen`. */
export const RipenTickSchema = v.object({
  id: v.string(),
  ripeness: v.number(),
  at: v.string(),
})

/** Liveness payload from `GET /health`. */
export const HealthSchema = v.object({
  status: v.literal('ripe'),
  at: v.string(),
})

/** Uniform error envelope. */
export const ErrorSchema = v.object({
  error: v.string(),
  message: v.string(),
})

export type Fruit = v.InferOutput<typeof FruitSchema>
export type NewFruit = v.InferInput<typeof NewFruitSchema>
export type FruitPatch = v.InferInput<typeof FruitPatchSchema>
export type FruitQuery = v.InferInput<typeof FruitQuerySchema>
export type FruitPage = v.InferOutput<typeof FruitPageSchema>
export type CheckoutOrder = v.InferInput<typeof CheckoutOrderSchema>
export type Receipt = v.InferOutput<typeof ReceiptSchema>
export type RipenTick = v.InferOutput<typeof RipenTickSchema>
export type HealthReport = v.InferOutput<typeof HealthSchema>
export type ErrorBody = v.InferOutput<typeof ErrorSchema>
