"use client"

import { MotionConfig } from "motion/react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { flushSync } from "react-dom"
import {
  createReducedMotionStore,
  dispatchMotionUpdate,
  type ActivationSource,
} from "@/lib/motion-policy"

interface MotionPolicyValue {
  reducedMotion: boolean
  runMotionUpdate: (source: ActivationSource, update: () => void) => void
}

const MotionPolicyContext = createContext<MotionPolicyValue | null>(null)

const reducedMotionStore = createReducedMotionStore((query) =>
  typeof window === "undefined" ? null : window.matchMedia(query)
)

export function MotionPolicyProvider({ children }: { children: ReactNode }) {
  const reducedMotion = useSyncExternalStore(
    reducedMotionStore.subscribe,
    reducedMotionStore.getSnapshot,
    reducedMotionStore.getServerSnapshot
  )
  const clearInstantFrame = useRef<number | null>(null)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.reducedMotion = reducedMotion ? "true" : "false"
    return () => {
      delete root.dataset.reducedMotion
    }
  }, [reducedMotion])

  useEffect(
    () => () => {
      if (clearInstantFrame.current !== null) {
        window.cancelAnimationFrame(clearInstantFrame.current)
      }
      delete document.documentElement.dataset.motionActivation
    },
    []
  )

  const updateInstantly = useCallback((update: () => void) => {
    const root = document.documentElement
    root.dataset.motionActivation = "instant"

    flushSync(update)
    // Commit the final styles while transitions are disabled. Removing the
    // marker next frame cannot retroactively animate this state change.
    void root.offsetWidth

    if (clearInstantFrame.current !== null) {
      window.cancelAnimationFrame(clearInstantFrame.current)
    }
    clearInstantFrame.current = window.requestAnimationFrame(() => {
      delete root.dataset.motionActivation
      clearInstantFrame.current = null
    })
  }, [])

  const runMotionUpdate = useCallback(
    (source: ActivationSource, update: () => void) => {
      dispatchMotionUpdate({
        source,
        reducedMotion,
        update,
        updateInstantly,
      })
    },
    [reducedMotion, updateInstantly]
  )

  const value = useMemo(
    () => ({ reducedMotion, runMotionUpdate }),
    [reducedMotion, runMotionUpdate]
  )

  return (
    <MotionPolicyContext.Provider value={value}>
      <MotionConfig
        reducedMotion={reducedMotion ? "always" : "never"}
        transition={reducedMotion ? { delay: 0, duration: 0 } : undefined}
      >
        {children}
      </MotionConfig>
    </MotionPolicyContext.Provider>
  )
}

export function useMotionPolicy() {
  const value = useContext(MotionPolicyContext)
  if (!value) {
    throw new Error("useMotionPolicy must be used within MotionPolicyProvider")
  }
  return value
}
