"use client"

import { useEffect, useState } from "react"

/**
 * How much of the viewport the software keyboard is covering, in pixels.
 *
 * A `position: fixed` bar is placed against the *layout* viewport, which a
 * phone keyboard does not shrink — so the bar ends up behind the keyboard, and
 * on iOS it also drifts as the page is scrolled while the keyboard is open.
 * The visual viewport is the one that knows: the gap between it and the layout
 * viewport is exactly the keyboard.
 *
 * Returns 0 when there is no keyboard, so callers can treat it as "add this to
 * whatever bottom offset you already have".
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    let frame = 0
    const measure = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const covered =
          window.innerHeight - viewport.height - viewport.offsetTop
        // A couple of pixels of rounding is not a keyboard, and neither is the
        // collapsing browser toolbar, which is why this is a threshold and not
        // a truthiness check.
        setInset(covered > 80 ? Math.round(covered) : 0)
      })
    }

    viewport.addEventListener("resize", measure)
    viewport.addEventListener("scroll", measure)
    measure()

    return () => {
      viewport.removeEventListener("resize", measure)
      viewport.removeEventListener("scroll", measure)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return inset
}
