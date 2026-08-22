"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { orpc } from "@/lib/orpc"
import type { MaterialRow } from "./materials-rows"

/** The server refuses more than this in one call, and says so. */
const MAX_PREVIEWS_PER_CALL = 200

/**
 * A signed URL lasts about an hour, so the answer is worth keeping for a good
 * part of that: re-minting two hundred URLs because the reader scrolled back up
 * is a round trip that buys nothing.
 */
const PREVIEW_STALE_TIME = 30 * 60 * 1000

/**
 * Thumbnails for the grid.
 *
 * The card view was four hundred identical grey squares, which is the whole
 * reason nobody switched to it — a grid is for recognising something, and an
 * icon repeated four hundred times carries no information at all.
 *
 * One batched call rather than one per card. A grid draws many at once by
 * definition, and a request per tile is how a folder of two hundred files
 * becomes two hundred requests; the server takes a list for exactly this
 * reason. Only rows whose preview is `ready` are asked for, so a pending or
 * unsupported file costs nothing and keeps its icon.
 */
export function useMaterialPreviews(
  rows: readonly MaterialRow[],
  enabled: boolean
): ReadonlyMap<string, string> {
  const documentIds = useMemo(
    () =>
      rows
        .filter(
          (row) => row.kind === "material" && row.previewStatus === "ready"
        )
        .slice(0, MAX_PREVIEWS_PER_CALL)
        .map((row) => row.id)
        .sort(),
    [rows]
  )

  // Sorted and joined, so scrolling a list back and forth resolves to the same
  // key rather than refetching the same set in a different order.
  const key = documentIds.join(",")

  const query = useQuery({
    ...orpc.materials.documents.previewUrls.queryOptions({
      input: { documentIds },
    }),
    enabled: enabled && documentIds.length > 0,
    staleTime: PREVIEW_STALE_TIME,
  })

  return useMemo(() => {
    const urls = new Map<string, string>()
    for (const row of rows) {
      if (row.source.kind !== "material") continue
      const candidate = row.source.row.document.thumbnailUrl
      if (!candidate) continue
      try {
        const url = new URL(candidate)
        if (url.protocol === "https:" && url.hostname === "i.ytimg.com") {
          urls.set(row.id, url.toString())
        }
      } catch {
        // Provider metadata is untrusted at the browser boundary. A malformed
        // thumbnail simply falls back to the normal file-type icon.
      }
    }
    for (const entry of query.data ?? []) {
      urls.set(entry.documentId, entry.url)
    }
    return urls
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, query.data, rows])
}
