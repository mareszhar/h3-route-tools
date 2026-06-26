import type {
  CheckoutOrder,
  Fruit,
  FruitPatch,
  NewFruit,
  Receipt,
  RipenTick,
  TransformedFruitQuery,
} from './schemas.ts'
import { ConflictError, NotFoundError, OutOfStockError } from './errors.ts'
import { seedFruits } from './seed.ts'

export interface RipenOptions {
  /** Ripeness gained per tick. */
  step?: number
  /** Delay between ticks in milliseconds. */
  intervalMs?: number
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Converts a string into a URL-friendly slug.
 * Replaces non-alphanumeric characters with hyphens and trims leading/trailing hyphens.
 */
function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

const sorters: Record<TransformedFruitQuery['sort'], (a: Fruit, b: Fruit) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  price: (a, b) => a.pricePerKg - b.pricePerKg,
  ripeness: (a, b) => b.ripeness - a.ripeness,
}

/**
 * The entire Orchard business layer, in memory and framework-agnostic.
 * Every backend instantiates one of these and only adds HTTP wiring on top.
 */
export function createOrchard(initial: Fruit[] = seedFruits) {
  const fruits = new Map<string, Fruit>(initial.map(f => [f.id, structuredClone(f)]))

  const require = (id: string): Fruit => {
    const fruit = fruits.get(id)
    if (!fruit)
      throw new NotFoundError(`fruit "${id}"`)
    return fruit
  }

  return {
    /** Filter → sort → cursor-paginate. */
    list(query: TransformedFruitQuery) {
      const { search, tag, minRipeness, sort, limit, cursor } = query

      const matched = [...fruits.values()]
        .filter(f => !search || f.name.toLowerCase().includes(search.toLowerCase()))
        .filter(f => !tag || f.tags.includes(tag))
        .filter(f => minRipeness === undefined || f.ripeness >= minRipeness)
        .sort(sorters[sort])

      const start = cursor ? matched.findIndex(f => f.id === cursor) + 1 : 0
      const items = matched.slice(start, start + limit)
      const nextCursor = start + limit < matched.length ? items.at(-1)!.id : null

      return { items, nextCursor }
    },

    get: (id: string): Fruit => structuredClone(require(id)),

    create(input: NewFruit): Fruit {
      const id = slugify(input.name)
      if (fruits.has(id))
        throw new ConflictError(`A fruit called "${input.name}" already exists`)

      const fruit: Fruit = { id, ...input, ripeness: 0 }
      fruits.set(id, fruit)
      return structuredClone(fruit)
    },

    update(id: string, patch: FruitPatch): Fruit {
      const fruit = require(id)
      Object.assign(fruit, patch)
      return structuredClone(fruit)
    },

    remove(id: string): void {
      require(id)
      fruits.delete(id)
    },

    /** Validate stock for the whole basket, then commit it atomically. */
    checkout(order: CheckoutOrder): Receipt {
      const lines = order.items.map(({ id, kg }) => {
        const fruit = require(id)
        if (fruit.stockKg < kg)
          throw new OutOfStockError(fruit.name, kg, fruit.stockKg)
        return { fruit, kg, subtotal: Math.round(fruit.pricePerKg * kg * 100) / 100 }
      })

      for (const { fruit, kg } of lines) fruit.stockKg -= kg

      return {
        lines: lines.map(({ fruit, kg, subtotal }) => ({
          id: fruit.id,
          name: fruit.name,
          kg,
          subtotal,
        })),
        total: Math.round(lines.reduce((sum, l) => sum + l.subtotal, 0) * 100) / 100,
        currency: 'USD',
      }
    },

    /** Stream ripeness ticks until the fruit is perfectly ripe (for SSE demos). */
    async* ripen(
      id: string,
      { step = 12, intervalMs = 400 }: RipenOptions = {},
    ): AsyncGenerator<RipenTick> {
      const fruit = require(id)
      while (fruit.ripeness < 100) {
        fruit.ripeness = Math.min(100, fruit.ripeness + step)
        yield { id: fruit.id, ripeness: fruit.ripeness, at: new Date().toISOString() }
        if (fruit.ripeness < 100)
          await sleep(intervalMs)
      }
    },
  }
}

export type Orchard = ReturnType<typeof createOrchard>
