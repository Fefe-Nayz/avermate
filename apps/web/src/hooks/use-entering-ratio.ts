"use client"

import { useEffect, useState } from "react"
import { useReducedMotion } from "motion/react"

/** Eased out cubically, so a value arrives the way the app's entrances do. */
function eased(progress: number): number {
  return 1 - (1 - progress) ** 3
}

/**
 * The value a figure is currently *showing*, on its way to the real one.
 *
 * The app's entrances animate a number from zero — a reel rolling up, a marker
 * travelling in from the left edge — and everything else about those figures
 * stayed at the destination while they did it. So a green badge counted up from
 * zero through results that are not green, and a green marker crossed the red
 * zone. The colour was asserting one verdict while the number said another, which
 * is worse than either alone.
 *
 * Nothing here can be a CSS transition. Colour is the thing that has to follow,
 * and CSS interpolating between two band colours passes through the space between
 * them: red to green by way of olive, a verdict that does not exist. Driving one
 * progress value in React instead means every reading — position, band, number —
 * is derived from the same travelled value, so no frame can disagree with itself.
 *
 * Opt-in per call site: with `enabled` false this returns the value untouched and
 * schedules nothing, because `AverageValue` is on almost every screen in the app
 * and most of those are not entering.
 */
export function useEnteringRatio(
  ratio: number | null,
  {
    enabled = false,
    /** Match whatever is animating the number beside it. */
    duration = 900,
  }: { enabled?: boolean; duration?: number } = {}
): number | null {
  const reduced = useReducedMotion()
  const [progress, setProgress] = useState(0)
  const running = enabled && !reduced

  useEffect(() => {
    if (!running) return
    let frame = 0
    const start = performance.now()
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / duration)
      setProgress(elapsed)
      if (elapsed < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [duration, ratio, running])

  // Read past the animation rather than seeding state from it: a reader who asked
  // for less motion gets the answer, and the effect never writes state on the way
  // in.
  if (!running || ratio === null) return ratio
  return ratio * eased(progress)
}
