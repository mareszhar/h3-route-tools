/**
 * `Serialize<T>` — the type a value becomes after a JSON round-trip (the wire
 * shape a fetch client receives). A handler validates the pre-serialization
 * value (e.g. a `Date`); the client gets the serialized form (a `string`).
 *
 * Owned by h3-dux, adapted from the original reference implementation (itself
 * adapted from remix's serialize type). It stays local because response wire
 * shape is part of h3-dux's contract kernel.
 *
 * One deliberate divergence (display only): the object/tuple branches are written
 * **inline** in the conditional rather than delegated to named `SerializeObject` /
 * `SerializeTuple` aliases, and objects drop non-JSON keys with a homomorphic
 * `as`-remap (`[K in keyof T as …]`) rather than `Omit<T, …>`. The resolved type is
 * identical, but with no alias to print TypeScript renders the literal — a
 * serialized response hovers as `{ id: string; … }`, never `SerializeObject<{ … }>`
 * (the wire-shape sibling of the delta-6 leak fix; dux-vision.md principle 3,
 * and how Hono's `JSONParsed` stays clean).
 */
export type Serialize<T>
  = IsAny<T> extends true
    ? any
    : IsUnknown<T> extends true
      ? unknown
      : T extends JsonPrimitive | undefined
        ? T
        : T extends Map<unknown, unknown> | Set<unknown>
          ? Record<string, never>
          : T extends NonJsonPrimitive
            ? never
            : T extends { toJSON: () => infer U }
              ? U
              : T extends []
                ? []
                : T extends [unknown, ...unknown[]]
                  ? { [K in keyof T]: T[K] extends NonJsonPrimitive ? null : Serialize<T[K]> }
                  : T extends ReadonlyArray<infer U>
                    ? (U extends NonJsonPrimitive ? null : Serialize<U>)[]
                    : T extends object
                      ? { [K in keyof T as T[K] extends NonJsonPrimitive ? never : K]: Serialize<T[K]> }
                      : never

type JsonPrimitive = string | number | boolean | null
type NonJsonPrimitive = undefined | ((...args: never[]) => unknown) | symbol

type IsAny<T> = 0 extends 1 & T ? true : false
type IsUnknown<T> = IsAny<T> extends true ? false : unknown extends T ? true : false
