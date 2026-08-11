"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"

/**
 * What the shell should put in its header for the screen currently rendered.
 *
 * Declared by the page rather than by the layout: only the page knows whether
 * it has a subtitle, an action, or a title that differs from its breadcrumb.
 * The shell owns the sticky positioning and the scroll behaviour.
 */

export interface PageChrome {
  title?: string
  subtitle?: string
  /** Where the back arrow goes. Omitted means "no back arrow". */
  backHref?: string
  /** Hides the large title, for screens that own their whole viewport. */
  bare?: boolean
}

// The value and the setter are separate contexts on purpose: a page declaring
// its title must not re-render because the title changed, which is exactly what
// a single combined context would cause.
const ChromeValueContext = createContext<PageChrome>({})
const ChromeSetContext = createContext<((value: PageChrome) => void) | null>(
  null
)

export const PAGE_ACTIONS_SLOT = "avermate-page-actions"

const subscribeToClient = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<PageChrome>({})

  return (
    <ChromeSetContext.Provider value={setChrome}>
      <ChromeValueContext.Provider value={chrome}>
        {children}
      </ChromeValueContext.Provider>
    </ChromeSetContext.Provider>
  )
}

export function usePageChrome(): PageChrome {
  return useContext(ChromeValueContext)
}

/** Declares the header text for a screen. */
export function PageMeta({ title, subtitle, backHref, bare }: PageChrome) {
  const set = useContext(ChromeSetContext)

  useEffect(() => {
    set?.({ title, subtitle, backHref, bare })
    return () => set?.({})
  }, [set, title, subtitle, backHref, bare])

  return null
}

/**
 * Puts controls on the trailing edge of the shell's header. A portal rather
 * than context state so the buttons keep their own handlers and re-render with
 * the page, not with the layout.
 */
export function PageActions({ children }: { children: ReactNode }) {
  const isClient = useSyncExternalStore(
    subscribeToClient,
    getClientSnapshot,
    getServerSnapshot
  )
  const target = isClient ? document.getElementById(PAGE_ACTIONS_SLOT) : null

  if (!target) return null
  return createPortal(children, target)
}
