import { locale } from "@/lib/i18n";

/**
 * Dates, in the reader's language.
 *
 * Kept apart from the value formatters: a date is a fact about the world, an
 * average is a computation, and only the second one depends on the year's
 * scale. Both are read constantly, so both are one call.
 */

function tag(): string {
  return locale() === "fr" ? "fr-FR" : "en-GB";
}

/** "5 August 2026" — for a headline or a detail line. */
export function formatDate(
  date: Date,
  style: "long" | "short" = "long",
): string {
  return date.toLocaleDateString(tag(), {
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
  });
}

/** "5 Aug" — for a list, where the year is implied by the screen. */
export function formatDay(date: Date): string {
  return date.toLocaleDateString(tag(), { day: "numeric", month: "short" });
}

/** "August 2026" — the heading of a month group. */
export function formatMonth(date: Date): string {
  return date.toLocaleDateString(tag(), { month: "long", year: "numeric" });
}

/** A plain number, grouped and rounded the way the locale expects. */
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString(tag(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** French keyboards give a comma; nobody should have to think about that. */
export function parseNumber(input: string): number | null {
  const normalised = input.replace(",", ".").trim();
  if (normalised === "") return null;
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}
