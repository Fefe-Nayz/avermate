"use client"

import { useFormatter, useExtracted } from "next-intl"
import type { SubjectComparisonRow } from "@avermate/core"
import { cn } from "@/lib/utils"
import { FOOTNOTE_TEXT } from "./card-figure"

/**
 * Two subject lists, side by side.
 *
 * The reading a pair of general averages hides: two people on the same average can be
 * strong in opposite halves of the year, and that is the thing worth knowing about a
 * friend you revise with.
 *
 * Matched by name in core — see `compareSubjects` — because two people's subject trees
 * have nothing else in common. Rows only one side has are shown with a dash rather than
 * dropped: a subject a friend does not share is a fact about the comparison, and hiding
 * it would make the two lists look more alike than they are.
 *
 * The gap is coloured, and *only* the gap: the two averages are read as numbers, and
 * painting somebody else's mark red would be this card taking a side.
 */
export function CardSubjectComparison({
  name,
  rows,
  hidden,
  scale,
  decimals,
  limit,
  ariaLabel,
}: {
  name: string
  rows: readonly SubjectComparisonRow[]
  hidden: number
  scale: number
  decimals: number
  /** How many rows fit; the rest are counted in the footer. */
  limit: number
  ariaLabel: string
}) {
  const t = useExtracted()
  const format = useFormatter()
  const shown = rows.slice(0, Math.max(1, limit))
  const mark = (value: number | null) =>
    value === null
      ? "—"
      : format.number(value * scale, { maximumFractionDigits: decimals })

  return (
    <figure
      className="flex h-full min-h-0 flex-col gap-1"
      aria-label={ariaLabel}
    >
      <table className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
            <th className="w-[46%] py-1 text-left font-medium">
              {t("Subject")}
            </th>
            <th className="py-1 text-right font-medium">{t("You")}</th>
            <th className="py-1 text-right font-medium">
              <span className="line-clamp-1">{name}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.name} className="border-t border-border/60">
              <td className="min-w-0 py-1 pr-2">
                <span className="line-clamp-1 break-words">{row.name}</span>
              </td>
              <td className="numeric py-1 text-right tabular-nums">
                {mark(row.mine)}
              </td>
              <td
                className={cn(
                  "numeric py-1 text-right tabular-nums",
                  // Only where both sides have a figure: a dash is not a comparison, and
                  // colouring it would read as a judgement about somebody's privacy.
                  row.gap === null
                    ? "text-muted-foreground"
                    : row.gap > 0
                      ? "text-positive"
                      : row.gap < 0
                        ? "text-negative"
                        : undefined
                )}
              >
                {mark(row.theirs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* What is not on the table: rows that did not fit, and subjects kept private. Two
          different absences, and a reader deserves to know which is which. */}
      {rows.length > shown.length || hidden > 0 ? (
        <figcaption className={cn(FOOTNOTE_TEXT, "text-muted-foreground")}>
          {rows.length > shown.length
            ? t("+{count} more · {hidden} not shared", {
                count: String(rows.length - shown.length),
                hidden: String(hidden),
              })
            : t("{hidden} subjects not shared", { hidden: String(hidden) })}
        </figcaption>
      ) : null}
    </figure>
  )
}
