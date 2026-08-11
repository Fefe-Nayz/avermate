"use client"

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react"
import { useMotionPolicy } from "@/components/motion-policy-provider"
import { resolveContinuousActivity } from "@/lib/continuous-animation"

const documentVisibilityStore = {
  subscribe(onChange: () => void) {
    if (typeof document === "undefined") return () => undefined
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  },
  getSnapshot() {
    return (
      typeof document === "undefined" || document.visibilityState === "visible"
    )
  },
  getServerSnapshot() {
    return true
  },
}

export function useDocumentVisibility() {
  return useSyncExternalStore(
    documentVisibilityStore.subscribe,
    documentVisibilityStore.getSnapshot,
    documentVisibilityStore.getServerSnapshot
  )
}

export function useContinuousAnimationActivity(
  target: RefObject<Element | null>,
  requested = true,
  threshold = 0.01
) {
  const { reducedMotion } = useMotionPolicy()
  const documentVisible = useDocumentVisibility()
  const [intersecting, setIntersecting] = useState(false)

  useEffect(() => {
    const element = target.current
    // Only the observer's own callback writes this state. Setting it straight
    // from the effect body — which the original did for the "no element" and
    // "no IntersectionObserver" cases — schedules a second render on every
    // mount, and every animated component on the page pays for it. An absent
    // element simply leaves the animation parked, which is the safe direction.
    if (!element || typeof IntersectionObserver === "undefined") return

    const observer = new IntersectionObserver(
      ([entry]) => setIntersecting(entry?.isIntersecting ?? false),
      { threshold }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [target, threshold])

  return {
    ...resolveContinuousActivity({
      requested,
      intersecting,
      documentVisible,
      reducedMotion,
    }),
    intersecting,
    documentVisible,
    reducedMotion,
  }
}
