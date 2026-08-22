import type { MaterialTagView } from "./materials-types"

/**
 * The colours a tag can wear.
 *
 * The server stores a token name and refuses a hex, which is the decision that
 * matters: a stored `#8ab4a0` is a colour that was legible in whichever theme
 * the person happened to be using when they picked it, and wrong in the other
 * one. A name resolves per theme, so a tag keeps its identity and stays
 * readable on both grounds.
 *
 * Six of them, deliberately. A palette that offers thirty makes choosing a
 * colour a decision, and the point of a tag colour is to be recognised across
 * a list at a glance — which needs the colours far apart, not numerous.
 */
export const MATERIAL_TAG_COLORS = [
  "slate",
  "emerald",
  "sky",
  "violet",
  "amber",
  "rose",
] as const

export type MaterialTagColor = (typeof MATERIAL_TAG_COLORS)[number]

export const DEFAULT_MATERIAL_TAG_COLOR: MaterialTagColor = "slate"

export function isMaterialTagColor(
  value: string | null | undefined
): value is MaterialTagColor {
  return (
    value !== null &&
    value !== undefined &&
    (MATERIAL_TAG_COLORS as readonly string[]).includes(value)
  )
}

/** An unknown or missing token falls back rather than rendering colourless. */
export function materialTagColor(
  value: string | null | undefined
): MaterialTagColor {
  return isMaterialTagColor(value) ? value : DEFAULT_MATERIAL_TAG_COLOR
}

/**
 * The chip, as classes.
 *
 * Written out rather than interpolated, because Tailwind reads source text: a
 * `bg-${color}-100` that never appears literally is a class that never ships.
 */
const CHIP: Record<MaterialTagColor, string> = {
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  emerald:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  violet:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
}

const DOT: Record<MaterialTagColor, string> = {
  slate: "bg-slate-400 dark:bg-slate-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
}

export function materialTagChipClass(color: string | null | undefined): string {
  return CHIP[materialTagColor(color)]
}

export function materialTagDotClass(color: string | null | undefined): string {
  return DOT[materialTagColor(color)]
}

/**
 * The tags on a row, resolved and ordered.
 *
 * Ordering follows the tag list rather than the link order, so the same two
 * tags read the same way on every row they are both on — chips that shuffle
 * between rows are chips you have to read instead of recognise.
 */
export function resolveMaterialTags(
  tagIds: readonly string[],
  tags: readonly MaterialTagView[]
): MaterialTagView[] {
  if (tagIds.length === 0) return []
  const wanted = new Set(tagIds)
  return tags.filter((tag) => wanted.has(tag.id))
}

/**
 * How many rows carry each tag.
 *
 * The rail shows the count beside the name for the same reason a folder shows
 * one: a tag nothing wears is a tag you meant to delete, and it should say so
 * rather than lead to an empty list.
 */
export function materialTagCounts(
  rows: readonly { tagIds: readonly string[] }[]
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const tagId of row.tagIds) {
      counts.set(tagId, (counts.get(tagId) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * A name that is free to use.
 *
 * The server has no uniqueness constraint on tag names, so two tags called
 * "révisions" are possible and are indistinguishable in every list they appear
 * in. This is what the create form checks against before it offers the button.
 */
export function materialTagNameTaken(
  name: string,
  tags: readonly MaterialTagView[],
  exceptTagId?: string
): boolean {
  const needle = name.trim().toLocaleLowerCase()
  if (!needle) return false
  return tags.some(
    (tag) =>
      tag.id !== exceptTagId && tag.name.trim().toLocaleLowerCase() === needle
  )
}
