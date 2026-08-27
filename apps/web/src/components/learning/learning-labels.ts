import { useExtracted } from "next-intl"
import type { ErrorTaxonomy } from "./copy-review-model"

/**
 * One exhaustive, extracted translation table for every difficulty taxonomy.
 *
 * The server returns stable taxonomy keys. Keeping the labels behind this
 * typed hook prevents a new key from leaking into the UI as title-cased
 * English and gives both the paper reviewer and the progress overview the same
 * wording.
 */
export function useLearningTaxonomyLabels(): Record<ErrorTaxonomy, string> {
  const t = useExtracted()
  return {
    "missing-knowledge": t("Missing knowledge"),
    "misunderstood-concept": t("Misunderstood concept"),
    "method-strategy": t("Method or strategy"),
    calculation: t("Calculation"),
    notation: t("Notation"),
    "reading-instruction": t("Reading the instructions"),
    justification: t("Justification"),
    transfer: t("Transfer"),
    "time-management": t("Time management"),
    unclassified: t("Unclassified"),
  }
}
