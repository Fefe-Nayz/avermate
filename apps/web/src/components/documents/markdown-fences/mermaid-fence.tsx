"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { embeddedFenceIssue } from "./model"
import { FenceFrame, FenceStatus } from "./fence-frame"
import { sanitizeGeneratedSvg } from "./sanitize-svg"

export function MermaidFence({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null)
  const reactId = useId()
  const { resolvedTheme } = useTheme()
  const [error, setError] = useState<string | null>(null)
  const issue = embeddedFenceIssue("mermaid", source)

  useEffect(() => {
    if (issue || !host.current) return
    let cancelled = false
    const target = host.current
    target.replaceChildren()
    setError(null)

    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid")
        if (cancelled) return
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: resolvedTheme === "dark" ? "dark" : "default",
          flowchart: { htmlLabels: false },
        })
        const id = `mermaid-${reactId.replace(/[^a-z0-9_-]/gi, "")}`
        const rendered = await mermaid.render(id, source)
        if (cancelled) return
        const parsed = new DOMParser().parseFromString(
          rendered.svg,
          "image/svg+xml"
        )
        const root = parsed.documentElement
        if (
          root.localName.toLowerCase() !== "svg" ||
          root.namespaceURI !== "http://www.w3.org/2000/svg"
        ) {
          throw new Error("Mermaid did not produce an SVG")
        }
        const imported = document.importNode(
          root,
          true
        ) as unknown as SVGSVGElement
        imported.setAttribute("aria-label", "Mermaid diagram")
        target.replaceChildren(sanitizeGeneratedSvg(imported))
      } catch {
        if (!cancelled) setError("This Mermaid diagram could not be rendered.")
      }
    })()

    return () => {
      cancelled = true
      target.replaceChildren()
    }
  }, [issue, reactId, resolvedTheme, source])

  return (
    <FenceFrame label="Mermaid diagram">
      {issue || error ? (
        <FenceStatus error>{issue ?? error}</FenceStatus>
      ) : (
        <div ref={host} className="flex min-h-24 justify-center" />
      )}
    </FenceFrame>
  )
}
