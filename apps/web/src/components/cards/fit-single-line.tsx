"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/** Uniformly shrink one line only when its natural width would overflow. */
export function fittedContentScale(
  availableWidth: number,
  naturalWidth: number
): number {
  if (availableWidth <= 0 || naturalWidth <= 0) return 1
  return Math.min(1, availableWidth / naturalWidth)
}

/**
 * Keep identity-bearing text complete and on one line. Long custom names are
 * uniformly reduced to the width already allocated by the card instead of
 * wrapping, clipping individual words or changing the outer grid row.
 */
export function FitSingleLine({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    const text = textRef.current
    if (!host || !text) return

    const fit = () => {
      text.style.transform = "none"
      const scale = fittedContentScale(host.clientWidth, text.scrollWidth)
      text.style.transform = `scale(${scale})`
    }

    fit()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(fit)
    observer.observe(host)
    observer.observe(text)
    return () => observer.disconnect()
  }, [children])

  return (
    <span
      ref={hostRef}
      className={cn(
        "block min-w-0 overflow-hidden whitespace-nowrap",
        className
      )}
    >
      <span
        ref={textRef}
        className="inline-block origin-left whitespace-nowrap"
      >
        {children}
      </span>
    </span>
  )
}
