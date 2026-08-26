/**
 * The shapes the paper-review screens share.
 *
 * These lived inside `copy-review-workspace.tsx` while it was the only file
 * that needed them. The review panes moved out into their own component, and a
 * type that two files both need is a module rather than a circular import
 * between them.
 */

export type ErrorTaxonomy =
  | "missing-knowledge"
  | "misunderstood-concept"
  | "method-strategy"
  | "calculation"
  | "notation"
  | "reading-instruction"
  | "justification"
  | "transfer"
  | "time-management"
  | "unclassified"

export const taxonomyValues: ErrorTaxonomy[] = [
  "missing-knowledge",
  "misunderstood-concept",
  "method-strategy",
  "calculation",
  "notation",
  "reading-instruction",
  "justification",
  "transfer",
  "time-management",
  "unclassified",
]

/** One region of a scanned paper, as the reviewer is editing it. */
export type RegionDraft = {
  selected: boolean
  objectiveId: string | null
  observedOutcome: string
  denominator: string
  difficulty: string
  taxonomy: ErrorTaxonomy | null
  explanation: string
}

/**
 * A highlight box over the scan, as CSS percentages.
 *
 * Returns `null` rather than a broken rectangle when the model hands back
 * something impossible — a coordinate outside 0–1, or a box whose right edge is
 * left of its left edge. A highlight drawn from bad numbers lands somewhere
 * confident and wrong, which is worse than no highlight.
 */
export function normalizedBboxStyle(
  bbox: [number, number, number, number] | undefined
) {
  if (!bbox) return null
  const [left, top, right, bottom] = bbox
  if (
    bbox.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
    right <= left ||
    bottom <= top
  ) {
    return null
  }
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${(right - left) * 100}%`,
    height: `${(bottom - top) * 100}%`,
  }
}

/** A fresh client-side id, for rows that do not have a server one yet. */
export function newKey() {
  return crypto.randomUUID()
}
