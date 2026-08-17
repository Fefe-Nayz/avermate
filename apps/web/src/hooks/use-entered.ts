"use client"

import { useEffect, useState } from "react"

/**
 * Whether the first paint is over.
 *
 * Every figure in this app arrives rather than appears — reels turn up from zero,
 * gauges fill, impact bars grow out of their centre — and all of them need the same
 * thing: one render at the resting value, then a frame later the real one, so the
 * browser has two states to interpolate between.
 *
 * Its own module rather than a component's, because a six-line hook should not drag
 * a rendering library behind it: this lived beside the number reels and importing it
 * pulled NumberFlow into every page that wanted an entrance.
 */
export function useEntered(): boolean {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  return entered
}

/** Zero on the first frame, so the reels and gauges have an entrance. */
export function useEnterValue(): (value: number | null) => number | null {
  const entered = useEntered()
  return (value) => (entered ? value : value === null ? null : 0)
}
