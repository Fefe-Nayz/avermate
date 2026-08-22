"use client"

import Link from "next/link"
import { useState, type ReactNode } from "react"
import { useExtracted, useFormatter } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { formatRecordingTimestamp } from "@/components/recordings/recording-model"
import { cn } from "@/lib/utils"
import { formatBytes, type MaterialRow } from "./materials-rows"
import type { PresentMaterialRow } from "./materials-presentation"

/**
 * The same folder, as cards.
 *
 * A table is for comparing: sorting by size, running the eye down a column of
 * dates. A grid is for recognising — one thing per card, a target big enough to
 * hit on a touchscreen, and the icon carrying the weight instead of a 16-pixel
 * glyph at the start of a row. Every file browser offers both, and the toolbar
 * switches between them without losing the order or the selection.
 */
export function MaterialsGrid({
  rows,
  present,
  onOpen,
  actions,
  originBadge,
  selectedIds,
  onSelectedIdsChange,
  emptyMessage,
  contextMenu,
  previews,
  tagChips,
}: {
  rows: readonly MaterialRow[]
  present: PresentMaterialRow
  onOpen: (row: MaterialRow) => void
  actions?: (row: MaterialRow) => ReactNode
  originBadge?: (row: MaterialRow) => ReactNode
  selectedIds?: ReadonlySet<string>
  onSelectedIdsChange?: (ids: Set<string>) => void
  emptyMessage?: ReactNode
  /** What a right click on a card offers. */
  contextMenu?: (row: MaterialRow) => ReactNode
  /** First pages and image thumbnails, keyed by row id; see plan 020 §3. */
  previews?: ReadonlyMap<string, string>
  /** The tags a card wears. */
  tagChips?: (row: MaterialRow) => ReactNode
}) {
  const t = useExtracted()
  const format = useFormatter()

  if (rows.length === 0) {
    return (
      <div className="grid flex-1 place-items-center p-6">{emptyMessage}</div>
    )
  }

  const toggle = (id: string, checked: boolean) => {
    if (!onSelectedIdsChange) return
    const next = new Set(selectedIds ?? [])
    if (checked) next.add(id)
    else next.delete(id)
    onSelectedIdsChange(next)
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {rows.map((row) => {
          const presentation = present(row)
          const selected = selectedIds?.has(row.id) ?? false
          const measure =
            row.kind === "folder"
              ? t(
                  "{count, plural, =0 {No items} one {# item} other {# items}}",
                  { count: row.itemCount ?? 0 }
                )
              : row.bytes !== null
                ? formatBytes(row.bytes)
                : row.durationMs !== null
                  ? formatRecordingTimestamp(row.durationMs)
                  : null

          const face = (
            <>
              {/* The tile is the real first page where there is one, and the
                  icon where there is not — never a spinner: a grid that waits
                  for two hundred thumbnails before drawing anything is a grid
                  that shows nothing for a second and a half. */}
              <Tile
                url={previews?.get(row.id)}
                icon={presentation.icon}
                accent={presentation.tone === "accent"}
                title={row.title}
              />
              <span className="mt-3 flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">
                  {row.title}
                </span>
                {originBadge?.(row)}
                {presentation.adornment}
              </span>
            </>
          )

          const card = (
            <div
              data-selected={selected || undefined}
              className="relative flex h-full flex-col rounded-xl border bg-card p-3 transition-colors hover:border-ring/60 data-selected:border-primary data-selected:ring-2 data-selected:ring-primary/20"
            >
              <div className="absolute start-4 top-4 z-10">
                {onSelectedIdsChange ? (
                  <Checkbox
                    checked={selected}
                    onCheckedChange={(checked) => toggle(row.id, checked)}
                    aria-label={t("Select {name}", { name: row.title })}
                    className="bg-background/80 backdrop-blur-xs"
                  />
                ) : null}
              </div>
              <div className="absolute end-2 top-2 z-10">{actions?.(row)}</div>

              {presentation.link ? (
                <Link
                  href={presentation.link.href}
                  prefetch={presentation.link.prefetch}
                  onClick={presentation.link.onClick}
                  aria-label={row.title}
                  className="flex min-w-0 flex-col rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {face}
                </Link>
              ) : (
                <button
                  type="button"
                  aria-label={row.title}
                  onClick={() => onOpen(row)}
                  className="flex min-w-0 flex-col rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {face}
                </button>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="font-mono text-[0.6rem]">
                  {row.badge}
                </Badge>
                {measure ? (
                  <span className="numeric truncate text-xs text-muted-foreground">
                    {measure}
                  </span>
                ) : null}
                {tagChips?.(row)}
              </div>

              <div className="mt-2 flex items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">
                  {presentation.detail}
                </span>
                {row.modifiedAt ? (
                  <time
                    dateTime={row.modifiedAt.toISOString()}
                    className="shrink-0 whitespace-nowrap"
                  >
                    {format.dateTime(row.modifiedAt, {
                      day: "numeric",
                      month: "short",
                    })}
                  </time>
                ) : null}
              </div>
            </div>
          )

          return (
            <li key={row.id}>
              {contextMenu ? (
                <ContextMenu>
                  <ContextMenuTrigger className="block h-full">
                    {card}
                  </ContextMenuTrigger>
                  <ContextMenuContent className="min-w-48">
                    {contextMenu(row)}
                  </ContextMenuContent>
                </ContextMenu>
              ) : (
                card
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The card's picture.
 *
 * A URL that has expired, or a preview the storage no longer has, must not
 * leave a broken-image glyph in the middle of the grid — so a failed load falls
 * back to the icon that was going to be there anyway. `object-cover` with the
 * top edge anchored, because the top of a first page is the part that says
 * which document it is.
 */
function Tile({
  url,
  icon,
  accent,
  title,
}: {
  url?: string
  icon: ReactNode
  accent: boolean
  title: string
}) {
  const [failed, setFailed] = useState(false)
  if (url && !failed) {
    return (
      <span className="block h-20 overflow-hidden rounded-lg border bg-muted">
        {/* A plain <img>: these are signed, short-lived URLs on whatever
            storage provider the deployment uses, which is the one thing
            next/image cannot take — it needs the host allow-listed at build
            time, and the provider is configuration. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          title={title}
          onError={() => setFailed(true)}
          className="size-full object-cover object-top"
        />
      </span>
    )
  }
  return (
    <span
      className={cn(
        "grid h-20 place-items-center rounded-lg [&_svg]:size-6",
        accent ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      )}
    >
      {icon}
    </span>
  )
}
