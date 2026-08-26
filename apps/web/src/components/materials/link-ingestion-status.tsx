"use client"

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  HelpCircleIcon,
  Link2OffIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import {
  normalizedLinkIngestionStatus,
  webProvenance,
  type LinkIngestionStatus,
} from "./link-ingestion-model"

export function LinkIngestionBadge({
  status,
  loading,
  error,
}: {
  status: LinkIngestionStatus | undefined
  loading?: boolean
  error?: boolean
}) {
  const t = useExtracted()
  const normalized = normalizedLinkIngestionStatus(status, loading, error)
  /**
   * "We could not check" is not "something is wrong with your link".
   *
   * `unavailable` means the status request itself failed — a network hiccup, an expired
   * session — and it was drawn exactly like `failed`: a red badge, a warning triangle,
   * and the words "Needs attention". So a moment offline told the reader their link
   * needed fixing, about a link that was never touched. The two states say different
   * things now, and only the one about the link is red.
   */
  const label =
    normalized === "unavailable"
      ? t("Status unavailable")
      : normalized === "loading"
        ? t("Checking import")
        : normalized === "pending"
          ? t("Importing")
          : normalized === "ready"
            ? t("Imported")
            : normalized === "failed"
              ? t("Import failed")
              : t("Not imported")

  return (
    <Badge
      variant={
        normalized === "failed"
          ? "destructive"
          : normalized === "ready"
            ? "secondary"
            : "outline"
      }
      aria-label={t("Link import status: {status}", { status: label })}
      className="max-w-full min-w-0"
    >
      {normalized === "pending" || normalized === "loading" ? (
        <Spinner className="size-3" />
      ) : normalized === "ready" ? (
        <CheckCircle2Icon aria-hidden className="size-3" />
      ) : normalized === "failed" ? (
        <AlertTriangleIcon aria-hidden className="size-3" />
      ) : normalized === "unavailable" ? (
        <HelpCircleIcon aria-hidden className="size-3" />
      ) : (
        <Link2OffIcon aria-hidden className="size-3" />
      )}
      <span className="truncate">{label}</span>
    </Badge>
  )
}

export function LinkProvenance({
  meta,
  sourceUrl,
  className,
}: {
  meta: unknown
  sourceUrl: string | null
  className?: string
}) {
  const t = useExtracted()
  const format = useFormatter()
  const provenance = webProvenance(meta, sourceUrl)
  if (!provenance) return null

  const date = provenance.fetchedAt
    ? format.dateTime(provenance.fetchedAt, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null

  return (
    <span className={cn("truncate", className)} title={provenance.url}>
      {date
        ? t("Imported from {host} on {date}", {
            host: provenance.host,
            date,
          })
        : t("Source: {host}", { host: provenance.host })}
      {provenance.byline
        ? t(" · by {author}", { author: provenance.byline })
        : null}
    </span>
  )
}
