"use client"

import { useEffect, useRef, useState } from "react"
import { embeddedFenceIssue } from "./model"
import { FenceFrame, FenceStatus } from "./fence-frame"
import { sanitizeGeneratedSvg } from "./sanitize-svg"

export function DotFence({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const issue = embeddedFenceIssue("dot", source)

  useEffect(() => {
    if (issue || !host.current) return
    let cancelled = false
    const target = host.current
    target.replaceChildren()
    setError(null)

    void (async () => {
      try {
        const { instance } = await import("@viz-js/viz")
        const viz = await instance()
        if (cancelled) return
        const svg = viz.renderSVGElement(source, { engine: "dot" })
        svg.setAttribute("aria-label", "Graphviz diagram")
        target.replaceChildren(sanitizeGeneratedSvg(svg))
      } catch {
        if (!cancelled) setError("This Graphviz diagram could not be rendered.")
      }
    })()

    return () => {
      cancelled = true
      target.replaceChildren()
    }
  }, [issue, source])

  return (
    <FenceFrame label="Graphviz diagram">
      {issue || error ? (
        <FenceStatus error>{issue ?? error}</FenceStatus>
      ) : (
        <div ref={host} className="flex min-h-24 justify-center" />
      )}
    </FenceFrame>
  )
}
