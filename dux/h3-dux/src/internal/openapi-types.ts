import type { H3RouteMeta } from 'h3'

export interface DuxOpenAPIObject extends Record<string, unknown> {
  hide?: boolean
  summary?: string
  description?: string
  operationId?: string
  tags?: string[]
  deprecated?: boolean
  security?: Array<Record<string, string[]>>
  externalDocs?: Record<string, unknown>
}

export type DuxOpenAPI = DuxOpenAPIObject | false

export type DuxMeta = H3RouteMeta & {
  openapi?: DuxOpenAPI
}

export function normalizeOpenAPI(value: DuxOpenAPI | undefined): DuxOpenAPIObject | undefined {
  if (value === false)
    return { hide: true }
  return value
}

export function mergeOpenAPI(...items: Array<DuxOpenAPI | undefined>): DuxOpenAPIObject | undefined {
  let merged: DuxOpenAPIObject | undefined
  for (const item of items) {
    const next = normalizeOpenAPI(item)
    if (!next)
      continue
    merged = mergeOpenAPIObject(merged, next)
  }
  return merged
}

function mergeOpenAPIObject(base: DuxOpenAPIObject | undefined, next: DuxOpenAPIObject): DuxOpenAPIObject {
  const merged: DuxOpenAPIObject = { ...(base ?? {}), ...next }
  if (base?.tags || next.tags)
    merged.tags = unique([...(base?.tags ?? []), ...(next.tags ?? [])])
  if (base?.security || next.security)
    merged.security = [...(base?.security ?? []), ...(next.security ?? [])]
  if (base?.hide || next.hide)
    merged.hide = true
  return merged
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}
