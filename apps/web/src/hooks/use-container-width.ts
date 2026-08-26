"use client"

import { useEffect, useState, type RefObject } from "react"

/**
 * The width of an element, not the width of the window.
 *
 * The assistant is both a full page and a side panel a few hundred pixels
 * wide. A viewport media query cannot tell those apart: inside a 500px panel
 * on a 1400px screen `(min-width: 768px)` answers "desktop", so the thread
 * rail planted itself at a static 288px and left the conversation 212px —
 * enough for one word per line.
 */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    setWidth(node.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])

  return width
}
