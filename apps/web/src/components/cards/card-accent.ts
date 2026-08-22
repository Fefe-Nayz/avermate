/**
 * Dashboard card accents.
 *
 * `accent` has been a real column, a real API field and a documented part of
 * `CardSpec` ("Named accent from the theme, e.g. chart-2") since the schema was
 * written — and it was rendered nowhere and never offered to anyone. The whole
 * dashboard was one flat grey grid as a result.
 *
 * The value arrives from the database as free text, so it is never
 * interpolated into a class name or a style. It is looked up in this table and
 * anything unrecognised falls back to no accent, which is also what `null`
 * means. That keeps a stored string from reaching the stylesheet.
 */

export interface CardAccent {
  /** The stored value. `null` is the default, un-accented card. */
  readonly value: string
  /** Translation key handled by the caller — this file stays framework-free. */
  readonly label: string
  /** A hairline along the card's top edge. */
  readonly bar: string
  /** The card's title, so the accent survives even when the bar is clipped. */
  readonly text: string
  /** The swatch in the picker. */
  readonly swatch: string
}

export const CARD_ACCENTS: readonly CardAccent[] = [
  {
    value: "primary",
    label: "Accent",
    bar: "bg-primary",
    text: "text-primary",
    swatch: "bg-primary",
  },
  {
    value: "positive",
    label: "Green",
    bar: "bg-positive",
    text: "text-positive",
    swatch: "bg-positive",
  },
  {
    value: "chart-2",
    label: "Teal",
    bar: "bg-chart-2",
    text: "text-chart-2",
    swatch: "bg-chart-2",
  },
  {
    value: "chart-3",
    label: "Blue",
    bar: "bg-chart-3",
    text: "text-chart-3",
    swatch: "bg-chart-3",
  },
  {
    value: "chart-4",
    label: "Purple",
    bar: "bg-chart-4",
    text: "text-chart-4",
    swatch: "bg-chart-4",
  },
  {
    value: "chart-5",
    label: "Amber",
    bar: "bg-chart-5",
    text: "text-chart-5",
    swatch: "bg-chart-5",
  },
]

const BY_VALUE = new Map(CARD_ACCENTS.map((accent) => [accent.value, accent]))

/** The accent for a stored value, or `null` for default and for anything unknown. */
export function cardAccent(
  value: string | null | undefined
): CardAccent | null {
  if (!value) return null
  return BY_VALUE.get(value) ?? null
}
