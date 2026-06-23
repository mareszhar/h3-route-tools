import * as v from 'valibot'

export const FruitSchema = v.object({
  id: v.string(),
  name: v.string(),
  emoji: v.string(),
  pricePerKg: v.pipe(v.number(), v.minValue(0)),
  ripeness: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
})

export type Fruit = v.InferOutput<typeof FruitSchema>

const fruits = new Map<string, Fruit>([
  ['mango', { id: 'mango', name: 'Mango', emoji: '🥭', pricePerKg: 5, ripeness: 60 }],
  ['kiwi', { id: 'kiwi', name: 'Kiwi', emoji: '🥝', pricePerKg: 8, ripeness: 30 }],
])

export const orchard = {
  list: (): Fruit[] => [...fruits.values()],
  get: (id: string): Fruit => {
    const fruit = fruits.get(id)
    if (!fruit)
      throw new Error(`No fruit "${id}"`)
    return fruit
  },
}
