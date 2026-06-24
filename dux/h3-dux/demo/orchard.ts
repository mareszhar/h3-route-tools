/**
 * The Orchard domain — valibot schemas + a tiny in-memory repository. This is
 * the only place business logic lives; the server is pure HTTP wiring.
 */
import * as v from 'valibot'

export const FruitSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(40)),
  emoji: v.pipe(v.string(), v.minLength(1)),
  pricePerKg: v.pipe(v.number(), v.minValue(0)),
  ripeness: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
  stockKg: v.pipe(v.number(), v.minValue(0)),
})
export const NewFruitSchema = v.omit(FruitSchema, ['id', 'ripeness'])
export const CheckoutSchema = v.object({
  items: v.pipe(v.array(v.object({ id: v.string(), kg: v.pipe(v.number(), v.minValue(0.01)) })), v.minLength(1)),
})
export const ReceiptSchema = v.object({
  lines: v.array(v.object({ id: v.string(), kg: v.number(), subtotal: v.number() })),
  total: v.number(),
})
export const RipenTickSchema = v.object({ id: v.string(), ripeness: v.number(), at: v.string() })
export const ErrorSchema = v.object({ error: v.string(), message: v.string() })

export type Fruit = v.InferOutput<typeof FruitSchema>
export type NewFruit = v.InferInput<typeof NewFruitSchema>
export type CheckoutOrder = v.InferInput<typeof CheckoutSchema>
export type Receipt = v.InferOutput<typeof ReceiptSchema>
export type RipenTick = v.InferOutput<typeof RipenTickSchema>

export class NotFoundError extends Error {}

export function createOrchard() {
  const fruits = new Map<string, Fruit>([
    ['mango', { id: 'mango', name: 'Mango', emoji: '🥭', pricePerKg: 5, ripeness: 60, stockKg: 12 }],
    ['kiwi', { id: 'kiwi', name: 'Kiwi', emoji: '🥝', pricePerKg: 8, ripeness: 30, stockKg: 7 }],
  ])
  const get = (id: string): Fruit => {
    const fruit = fruits.get(id)
    if (!fruit)
      throw new NotFoundError(`No fruit "${id}"`)
    return fruit
  }
  return {
    list: (): Fruit[] => [...fruits.values()],
    get,
    create: (body: NewFruit): Fruit => {
      const fruit: Fruit = { ...body, id: body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ripeness: 0 }
      fruits.set(fruit.id, fruit)
      return fruit
    },
    remove: (id: string): void => {
      get(id)
      fruits.delete(id)
    },
    checkout: (order: CheckoutOrder): Receipt => {
      const lines = order.items.map((item) => {
        const fruit = get(item.id)
        return { id: fruit.id, kg: item.kg, subtotal: item.kg * fruit.pricePerKg }
      })
      return { lines, total: lines.reduce((sum, line) => sum + line.subtotal, 0) }
    },
    * ripen(id: string): Generator<RipenTick> {
      let { ripeness } = get(id)
      while (ripeness < 100) {
        ripeness = Math.min(100, ripeness + 20)
        yield { id, ripeness, at: new Date().toISOString() }
      }
    },
  }
}
