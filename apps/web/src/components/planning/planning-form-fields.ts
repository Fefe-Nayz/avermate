"use client"

import { useMemo } from "react"
import { useExtracted } from "next-intl"
import type { useYear } from "@/components/year/year-provider"

/**
 * The two things all three planning forms ask the same way.
 *
 * They each built their own subject list and their own date-to-input
 * conversion, which is how "No subject" ended up worded three times and how one
 * of them offered categories as if you could file homework under "Sciences" the
 * heading rather than under a subject.
 */

type Graph = ReturnType<typeof useYear>["graph"]

/** Every real subject, plus the "none" the controls need instead of null. */
export function useSubjectOptions(graph: Graph) {
  const t = useExtracted()
  return useMemo(
    () => [
      { value: "none", label: t("No subject") },
      ...graph
        .flatten()
        // A category groups subjects; nothing is filed directly under one.
        .filter((subject) => subject.kind !== "category")
        .map((subject) => ({ value: subject.id, label: subject.name })),
    ],
    [graph, t]
  )
}

/** A date as `<input type="date">` wants it, in the reader's own zone. */
export function inputDate(value: Date | null): string {
  if (!value) return ""
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${value.getFullYear()}-${month}-${day}`
}

/** The clock part of an instant, `HH:mm`. */
export function inputTime(value: Date | null): string {
  if (!value) return ""
  const hours = String(value.getHours()).padStart(2, "0")
  const minutes = String(value.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}
