"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useAuthenticatedUser } from "@/components/authenticated-user"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "./app-sidebar"
import { SiteHeader } from "./site-header"
import { MobileHeader } from "./mobile-header"
import { MobileTabBar } from "./mobile-tabbar"
import { AnnouncementBanner } from "@/components/announcements/announcement-banner"
import { TimelineBanner } from "./timeline-banner"

/**
 * One tree, two layouts.
 *
 * The desktop chrome and the phone chrome are both mounted and CSS decides
 * which is visible. Rendering `children` once is the whole point: resizing a
 * window, rotating a tablet or opening the devtools device toolbar must not
 * remount the page or throw away what someone was typing.
 *
 * The page scrolls inside a container rather than the document, which is what
 * lets the phone header collapse and the desktop header stay put.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const user = useAuthenticatedUser()
  const pathname = usePathname()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollState, setScrollState] = useState(() => ({
    condensed: false,
    pathname,
  }))
  const condensed = scrollState.pathname === pathname && scrollState.condensed

  // A new screen starts at the top. Restoring position across routes reads as
  // a bug on a phone, where the header would come back already collapsed.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [pathname])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return

    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        // A dead band around the threshold: without it, a title that toggles
        // changes the content height and can oscillate against the scroll.
        setScrollState((current) => {
          const wasCondensed =
            current.pathname === pathname && current.condensed
          const condensed = wasCondensed
            ? node.scrollTop > 12
            : node.scrollTop > 36

          if (
            current.pathname === pathname &&
            current.condensed === condensed
          ) {
            return current
          }

          return { condensed, pathname }
        })
      })
    }

    node.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      node.removeEventListener("scroll", onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [pathname])

  return (
    <SidebarProvider
      className="h-svh min-h-0 overflow-hidden"
      style={{ "--sidebar-width": "16rem" } as React.CSSProperties}
    >
      <AppSidebar user={user} />
      <SidebarInset className="min-w-0 overflow-hidden">
        <SiteHeader />
        <MobileHeader user={user} condensed={condensed} />
        <TimelineBanner />
        <AnnouncementBanner />

        <div
          ref={scrollRef}
          className="scroll-pane pane-inset @container/main min-w-0 flex-1 md:pb-6"
        >
          <div className="mx-auto w-full max-w-6xl px-4 pt-1 pb-6 md:px-6 md:pt-4">
            {children}
          </div>
        </div>

        <MobileTabBar />
      </SidebarInset>
    </SidebarProvider>
  )
}
