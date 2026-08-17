"use client"

import { usePathname } from "next/navigation"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useAuthenticatedUser } from "@/components/authenticated-user"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "./app-sidebar"
import { SiteHeader } from "./site-header"
import { MobileHeader, MobilePageTitle } from "./mobile-header"
import { MobileTabBar } from "./mobile-tabbar"
import { AnnouncementBanner } from "@/components/announcements/announcement-banner"
import { TimelineBanner } from "./timeline-banner"
import { PullToRefresh } from "./pull-to-refresh"
import { ScrollPaneProvider } from "./scroll-pane"
import { usePaneScrollRestoration } from "@/hooks/use-pane-scroll-restoration"

/**
 * One tree, two layouts.
 *
 * The desktop chrome and the phone chrome are both mounted and CSS decides
 * which is visible. Rendering `children` once is the whole point: resizing a
 * window, rotating a tablet or opening the devtools device toolbar must not
 * remount the page or throw away what someone was typing.
 *
 * The page scrolls inside a container rather than the document. On phones the
 * large title is the first item in that flow while the compact bar stays put,
 * so revealing the title never changes the scroll pane's own height.
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

  // A new screen starts at the top; a screen you came *back* to starts where
  // you left it. See the hook for why those are opposite requirements and how
  // they are told apart.
  usePaneScrollRestoration(scrollRef, pathname)

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return

    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        // A dead band around the title threshold avoids flickering when touch
        // momentum settles on the boundary.
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
      // `overflow-clip`, not `overflow-hidden`: hidden boxes are still
      // programmatically scrollable, and the router's scrollIntoView/focus on
      // navigation could shove the whole shell up with no way to scroll back.
      // Clip clips without ever becoming a scroll container.
      className="h-svh min-h-0 overflow-clip"
      style={{ "--sidebar-width": "16rem" } as React.CSSProperties}
    >
      <AppSidebar user={user} />
      <ScrollPaneProvider paneRef={scrollRef}>
        <SidebarInset className="min-w-0 overflow-clip">
          <SiteHeader user={user} />
          <MobileHeader user={user} condensed={condensed} />
          <TimelineBanner />
          <AnnouncementBanner />

          {/* `relative` so the pull indicator can hang over the top of the
              pane without joining its scroll flow. */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <PullToRefresh paneRef={scrollRef} />
            <div
              ref={scrollRef}
              className="scroll-pane pane-inset @container/main min-w-0 flex-1 md:pb-[max(1.5rem,var(--spacing-safe-bottom))]"
            >
              <div className="mx-auto w-full max-w-6xl pt-1 pr-[max(1rem,var(--spacing-safe-right))] pb-6 pl-[max(1rem,var(--spacing-safe-left))] md:pt-4 md:pr-[max(1.5rem,var(--spacing-safe-right))] md:pl-[max(1.5rem,var(--spacing-safe-left))]">
                <MobilePageTitle />
                {children}
              </div>
            </div>
          </div>

          <MobileTabBar />
        </SidebarInset>
      </ScrollPaneProvider>
    </SidebarProvider>
  )
}
