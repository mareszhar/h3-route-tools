/**
 * A tiny in-memory Orchard repository for runtime tests. Pure domain logic, no
 * HTTP — the route handlers in `app.ts` wrap it.
 */
import type { CheckoutOrder, Fruit, FruitPatch, NewFruit, Receipt, RipenTick } from './schemas.ts'

const SEED: Fruit[] = [
  { id: 'mango', name: 'Mango', emoji: '🥭', color: 'orange', tags: ['sweet'], pricePerKg: 5, ripeness: 60, stockKg: 12 },
  { id: 'kiwi', name: 'Kiwi', emoji: '🥝', color: 'green', tags: ['tart'], pricePerKg: 8, ripeness: 30, stockKg: 7 },
]

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export class NotFoundError extends Error {}
export class OutOfStockError extends Error {}

export function createOrchard() {
  const fruits = new Map<string, Fruit>(SEED.map(f => [f.id, { ...f }]))

  function get(id: string): Fruit {
    const fruit = fruits.get(id)
    if (!fruit)
      throw new NotFoundError(`No fruit "${id}"`)
    return fruit
  }

  return {
    list: (): Fruit[] => [...fruits.values()],
    get,
    create: (body: NewFruit): Fruit => {
      const fruit: Fruit = { ...body, id: slug(body.name), ripeness: 0 }
      fruits.set(fruit.id, fruit)
      return fruit
    },
    update: (id: string, patch: FruitPatch): Fruit => {
      const fruit = { ...get(id), ...patch }
      fruits.set(id, fruit)
      return fruit
    },
    remove: (id: string): void => {
      get(id)
      fruits.delete(id)
    },
    checkout: (order: CheckoutOrder): Receipt => {
      const lines = order.items.map((item) => {
        const fruit = get(item.id)
        if (fruit.stockKg < item.kg)
          throw new OutOfStockError(`Not enough ${fruit.name}`)
        return { id: fruit.id, name: fruit.name, kg: item.kg, subtotal: item.kg * fruit.pricePerKg }
      })
      return { lines, total: lines.reduce((sum, l) => sum + l.subtotal, 0), currency: 'USD' }
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

export type Orchard = ReturnType<typeof createOrchard>
