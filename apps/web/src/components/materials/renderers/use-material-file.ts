"use client"

import { useQuery } from "@tanstack/react-query"
import { rpc } from "@/lib/orpc"

/**
 * A short-lived URL for the bytes behind a row.
 *
 * The list deliberately never carries one: a private URL in a cached list of
 * four hundred rows is four hundred credentials sitting in memory for as long
 * as the tab is open. It is minted when something is actually opened, and it is
 * not cached beyond that — `gcTime: 0` — because it expires anyway and a stale
 * one fails in a way nobody can diagnose from the screen.
 *
 * A query rather than the mutation the old viewer used, because "the bytes of
 * this document" is a read: it should be able to retry, to report loading, and
 * to be shared by two renderers looking at the same file.
 */
export function useMaterialFileUrl(documentId: string, enabled = true) {
  return useQuery({
    queryKey: ["material-file-url", documentId],
    queryFn: () => rpc.materials.documents.download({ documentId }),
    enabled: enabled && documentId.length > 0,
    gcTime: 0,
    staleTime: 0,
    retry: 1,
  })
}

/**
 * The same bytes, as text.
 *
 * For the renderers that parse rather than embed — CSV into a table, a `.tex`
 * source into an editor. Capped, because a renderer is not a reason to pull a
 * 200 MB file into a string: past the cap the reader is offered the download
 * instead, which is the honest outcome.
 */
export const MAX_INLINE_TEXT_BYTES = 2 * 1024 * 1024

export function useMaterialFileText(
  documentId: string,
  byteSize: number | null,
  enabled = true
) {
  const tooLarge = byteSize !== null && byteSize > MAX_INLINE_TEXT_BYTES
  const file = useMaterialFileUrl(documentId, enabled && !tooLarge)
  const url = file.data?.url

  const text = useQuery({
    queryKey: ["material-file-text", documentId, url],
    queryFn: async () => {
      if (!url) throw new Error("missing url")
      const response = await fetch(url)
      if (!response.ok) throw new Error(`file ${response.status}`)
      return response.text()
    },
    enabled: Boolean(url),
    gcTime: 0,
    retry: 1,
  })

  return {
    tooLarge,
    text: text.data ?? null,
    isPending: !tooLarge && (file.isPending || text.isPending),
    isError: file.isError || text.isError,
    error: file.error ?? text.error,
    refetch: () => {
      void file.refetch()
      void text.refetch()
    },
  }
}
