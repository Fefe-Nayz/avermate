"use client"

import { useExtracted } from "next-intl"

/** Enum values, translated where readers see them. */
export function useSocialLabels() {
  const t = useExtracted()
  return {
    reportCategory(value: string) {
      switch (value) {
        case "harassment":
          return t("Harassment")
        case "privacy":
          return t("Privacy")
        case "impersonation":
          return t("Impersonation")
        case "unsafe_content":
          return t("Unsafe content")
        default:
          return t("Other")
      }
    },
    reportStatus(value: string) {
      switch (value) {
        case "open":
          return t("Open")
        case "investigating":
          return t("Investigating")
        case "resolved":
          return t("Resolved")
        default:
          return t("Dismissed")
      }
    },
    reportPriority(value: string) {
      switch (value) {
        case "urgent":
          return t("Urgent")
        case "high":
          return t("High")
        case "low":
          return t("Low")
        default:
          return t("Normal")
      }
    },
    groupState(value: string) {
      switch (value) {
        case "frozen":
          return t("On hold")
        default:
          return t("Active")
      }
    },
    groupKind(value: string) {
      switch (value) {
        case "class":
          return t("Class")
        case "study":
          return t("Study group")
        default:
          return t("Friends group")
      }
    },
    comparison(kind: string, subjectName?: string | null) {
      switch (kind) {
        case "subject":
          return subjectName ?? t("Subject")
        case "median":
          return t("Median grade")
        case "passRate":
          return t("Pass rate")
        case "goalProgress":
          return t("Goals achieved")
        default:
          return t("General average")
      }
    },
  }
}
