/** JSON-like data accepted by the declarative widget editor. */
export type WidgetDraftValue =
  | null
  | boolean
  | number
  | string
  | WidgetDraftValue[]
  | { [key: string]: WidgetDraftValue }

function segments(path: string): string[] {
  return path
    .replace(/^\$\.?/, "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)
}

export function widgetDraftValue(
  draft: unknown,
  path: string
): WidgetDraftValue | undefined {
  let current: unknown = draft
  for (const segment of segments(path)) {
    if (!current || typeof current !== "object") return undefined
    current = Array.isArray(current)
      ? current[Number.parseInt(segment, 10)]
      : (current as Record<string, unknown>)[segment]
  }
  return current as WidgetDraftValue | undefined
}

/**
 * Immutably replaces one field in a widget draft.
 *
 * Descriptor paths are object paths today, but numeric segments are supported
 * so the same renderer can edit filters and thresholds without a second state
 * model later.
 */
export function setWidgetDraftValue<T extends WidgetDraftValue>(
  draft: T,
  path: string,
  value: WidgetDraftValue
): T {
  const parts = segments(path)
  if (parts.length === 0) return value as T

  const write = (current: WidgetDraftValue | undefined, index: number) => {
    const key = parts[index] as string
    const last = index === parts.length - 1
    const numeric = /^\d+$/.test(key)

    if (numeric) {
      const next = Array.isArray(current) ? [...current] : []
      const position = Number.parseInt(key, 10)
      next[position] = last ? value : write(next[position], index + 1)
      return next
    }

    const next =
      current && typeof current === "object" && !Array.isArray(current)
        ? { ...current }
        : {}
    next[key] = last
      ? value
      : write(next[key] as WidgetDraftValue | undefined, index + 1)
    return next
  }

  return write(draft, 0) as T
}

/** Remove inactive data and prune now-empty containers. */
export function removeWidgetDraftValue<T extends WidgetDraftValue>(
  draft: T,
  path: string
): T {
  const parts = segments(path)
  if (parts.length === 0) return draft

  const remove = (
    current: WidgetDraftValue | undefined,
    index: number
  ): WidgetDraftValue | undefined => {
    if (!current || typeof current !== "object") return current
    const key = parts[index] as string
    const last = index === parts.length - 1

    if (Array.isArray(current)) {
      const position = Number.parseInt(key, 10)
      if (!Number.isInteger(position)) return current
      const next = [...current]
      if (last) next.splice(position, 1)
      else {
        const child = remove(next[position], index + 1)
        if (child === undefined) next.splice(position, 1)
        else next[position] = child
      }
      return next.length > 0 ? next : undefined
    }

    const next = { ...current }
    if (last) delete next[key]
    else {
      const child = remove(next[key], index + 1)
      if (child === undefined) delete next[key]
      else next[key] = child
    }
    return Object.keys(next).length > 0 ? next : undefined
  }

  return (remove(draft, 0) ?? {}) as T
}
