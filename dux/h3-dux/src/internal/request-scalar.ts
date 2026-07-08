/** Serialize one logical params/query/header value into an HTTP request scalar. */
export function serializeRequestScalar(value: unknown): string {
  if (value instanceof Date)
    return value.toISOString()
  switch (typeof value) {
    case 'string':
      return value
    case 'number':
    case 'bigint':
    case 'boolean':
      return String(value)
  }
  throw new TypeError(
    `cannot serialize ${value === null ? 'null' : typeof value} as a request scalar`,
  )
}
