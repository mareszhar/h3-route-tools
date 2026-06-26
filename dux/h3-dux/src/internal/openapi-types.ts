import type { H3RouteMeta } from 'h3'

export interface H3DuxOpenAPIObject extends Record<string, unknown> {
  hide?: boolean
  summary?: string
  description?: string
  operationId?: string
  tags?: string[]
  deprecated?: boolean
  security?: Array<Record<string, string[]>>
  externalDocs?: Record<string, unknown>
}

export type H3DuxOpenAPI = H3DuxOpenAPIObject | false

export type H3DuxMeta = H3RouteMeta & {
  openapi?: H3DuxOpenAPI
}

export function normalizeOpenAPI(value: H3DuxOpenAPI | undefined): H3DuxOpenAPIObject | undefined {
  if (value === false)
    return { hide: true }
  return value
}

export function mergeOpenAPI(...items: Array<H3DuxOpenAPI | undefined>): H3DuxOpenAPIObject | undefined {
  let merged: H3DuxOpenAPIObject | undefined
  for (const item of items) {
    const next = normalizeOpenAPI(item)
    if (!next)
      continue
    merged = mergeOpenAPIObject(merged, next)
  }
  return merged
}

function mergeOpenAPIObject(base: H3DuxOpenAPIObject | undefined, next: H3DuxOpenAPIObject): H3DuxOpenAPIObject {
  const merged: H3DuxOpenAPIObject = { ...(base ?? {}), ...next }
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
