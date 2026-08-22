"use client"

import type { ReactNode } from "react"
import { StickyStateContext } from "@/hooks/use-sticky-state"
import type { StickyStateSnapshot } from "@/lib/sticky-state"

/**
 * Hands the request's remembered layout choices to the tree.
 *
 * Mounted from the root layout so every route gets them, authenticated or not:
 * the cookies are the only way a server render can know which view a screen was
 * left on. See `lib/sticky-state`.
 */
export function StickyStateProvider({
  children,
  value,
}: {
  children: ReactNode
  value: StickyStateSnapshot
}) {
  return (
    <StickyStateContext.Provider value={value}>
      {children}
    </StickyStateContext.Provider>
  )
}
