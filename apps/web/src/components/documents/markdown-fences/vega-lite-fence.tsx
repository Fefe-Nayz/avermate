"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { parseSafeVegaLiteSpec } from "./model"
import { FenceFrame, FenceStatus } from "./fence-frame"
import { sanitizeGeneratedSvg } from "./sanitize-svg"

export function VegaLiteFence({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null)
  const parsed = useMemo(() => parseSafeVegaLiteSpec(source), [source])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!parsed.ok || !host.current) return
    let cancelled = false
    let finalize: (() => void) | undefined
    const target = host.current
    target.replaceChildren()
    setError(null)

    void (async () => {
      try {
        const { default: embed, vega } = await import("vega-embed")
        if (cancelled) return
        const loader = vega.loader()
        loader.load = async () => {
          throw new Error("External Vega resources are disabled")
        }
        const result = await embed(target, parsed.spec, {
          actions: false,
          loader,
          mode: "vega-lite",
          renderer: "svg",
          tooltip: false,
        })
        finalize = () => result.view.finalize()
        if (cancelled) {
          finalize()
          return
        }
        const svg = target.querySelector("svg")
        if (svg) {
          svg.setAttribute("aria-label", "Vega-Lite chart")
          sanitizeGeneratedSvg(svg)
        }
      } catch {
        if (!cancelled) setError("This Vega-Lite chart could not be rendered.")
      }
    })()

    return () => {
      cancelled = true
      finalize?.()
      target.replaceChildren()
    }
  }, [parsed])

  return (
    <FenceFrame label="Vega-Lite chart">
      {!parsed.ok || error ? (
        <FenceStatus error>{parsed.ok ? error : parsed.issue}</FenceStatus>
      ) : (
        <div ref={host} className="min-h-32 overflow-auto" />
      )}
    </FenceFrame>
  )
}
