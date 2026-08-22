"use client"

import { useState } from "react"
import { useExtracted } from "next-intl"
import { MinusIcon, PlusIcon, Maximize2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { materialFileOf } from "./row-file"
import { RendererBar, RendererError, RendererLoading } from "./renderer-chrome"
import { useMaterialFileUrl } from "./use-material-file"
import type { MaterialRenderProps, MaterialRenderer } from "./registry"

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml",
])

const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4] as const

/**
 * A scan of a handout, at a size you can read.
 *
 * Fitted to the pane by default and zoomable in steps rather than freely: a
 * photographed page is usually taken at an angle and at a resolution far above
 * the pane, so "fit" is the right first sight of it and stepped zoom is what
 * gets you to a legible paragraph without a pinch gesture on a laptop.
 */
function ImageReader({ row }: MaterialRenderProps) {
  const t = useExtracted()
  const [zoom, setZoom] = useState<number | null>(null)
  const source = useMaterialFileUrl(row.id)

  if (source.isPending) return <RendererLoading />
  if (source.isError || !source.data?.url) {
    return (
      <RendererError
        message={
          source.error?.message ?? t("The original source is unavailable.")
        }
        onRetry={() => void source.refetch()}
      />
    )
  }

  const step = (direction: 1 | -1) => {
    const current = zoom ?? 1
    const index = ZOOMS.findIndex((value) => value >= current)
    const next =
      ZOOMS[Math.min(Math.max(index + direction, 0), ZOOMS.length - 1)]
    setZoom(next ?? 1)
  }

  return (
    <>
      <RendererBar>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t("Zoom out")}
          onClick={() => step(-1)}
        >
          <MinusIcon />
        </Button>
        <span className="numeric w-12 text-center text-xs text-muted-foreground">
          {zoom === null ? t("Fit") : `${Math.round(zoom * 100)}%`}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t("Zoom in")}
          onClick={() => step(1)}
        >
          <PlusIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setZoom(null)}
          disabled={zoom === null}
        >
          <Maximize2Icon /> {t("Fit")}
        </Button>
      </RendererBar>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={source.data.url}
          alt={row.title}
          className={
            zoom === null
              ? "mx-auto max-h-full max-w-full object-contain"
              : "mx-auto max-w-none"
          }
          style={zoom === null ? undefined : { width: `${zoom * 100}%` }}
        />
      </div>
    </>
  )
}

export const imageRenderer: MaterialRenderer = {
  id: "image",
  priority: 70,
  accepts: (row) => {
    const file = materialFileOf(row)
    return Boolean(file && IMAGE_TYPES.has(file.mimeType))
  },
  Reader: ImageReader,
}
