/**
 * `Serialize<T>` — the type a value becomes after a JSON round-trip (the wire
 * shape a fetch client receives). A handler validates the pre-serialization
 * value (e.g. a `Date`); the client gets the serialized form (a `string`).
 *
 * VENDORED, verbatim in behavior, from `h3-route-tools` `src/internal/serialize.ts`
 * (itself adapted from remix's serialize type). Kept here because upstream does
 * not export it, and our verb-sugar response types must match the base client's
 * exactly. The fork-rebase ritual (docs/dux-spec-workspace.md §6) re-checks it.
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
                  ? SerializeTuple<T>
                  : T extends ReadonlyArray<infer U>
                    ? (U extends NonJsonPrimitive ? null : Serialize<U>)[]
                    : T extends object
                      ? SerializeObject<T>
                      : never

type JsonPrimitive = string | number | boolean | null
type NonJsonPrimitive = undefined | ((...args: never[]) => unknown) | symbol

type IsAny<T> = 0 extends 1 & T ? true : false
type IsUnknown<T> = IsAny<T> extends true ? false : unknown extends T ? true : false

/** Keys of `T` whose value is a non-JSON primitive (dropped by `JSON.stringify`). */
type FilterKeys<T extends object, Filter> = {
  [K in keyof T]: T[K] extends Filter ? K : never;
}[keyof T]

type SerializeTuple<T extends [unknown, ...unknown[]]> = {
  [K in keyof T]: T[K] extends NonJsonPrimitive ? null : Serialize<T[K]>;
}

type SerializeObject<T extends object> = {
  [K in keyof Omit<T, FilterKeys<T, NonJsonPrimitive>>]: Serialize<T[K]>;
}
