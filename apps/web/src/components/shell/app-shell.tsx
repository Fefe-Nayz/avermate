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
import { isFullBleedRoute } from "./page-layout"
import { cn } from "@/lib/utils"
import {
  AssistantPanel,
  AssistantPanelProvider,
} from "@/components/assistant/assistant-panel"

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
  // A browser-style screen takes the pane instead of sitting in the centred
  // column every reading screen uses. Read from the path, so the first paint is
  // already the right shape.
  const fullBleed = isFullBleedRoute(pathname)

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
      /*
       * `defaultWidth`, not an inline `--sidebar-width`.
       *
       * The provider keeps the width in state and writes it to that
       * variable, then spreads the caller's `style` over the top — so a
       * hard 16rem here won every drag, and the rail moved nothing.
       */
      defaultWidth="16rem"
    >
      <AppSidebar user={user} />
      {/*
        `SidebarInset` is a direct sibling of `AppSidebar`, and has to be.
        
        The inset look — the margin, the rounded corners, the shadow — comes
        from `peer-data-[variant=inset]:*` on the inset, and `peer` only ever
        matches a *preceding sibling*. A `<div className="flex …">` wrapping
        the inset so the assistant panel could sit beside it made the inset a
        grandchild, and the whole variant silently stopped applying. The rail's
        drag position is measured from the inset's rect, so sidebar resizing
        went with it. The panel is a third flex child of the same row instead.
      */}
      <AssistantPanelProvider userId={user.id}>
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
                className={cn(
                  "scroll-pane pane-inset @container/main min-w-0 flex-1",
                  fullBleed
                    ? // Two panes that scroll independently cannot live inside a
                      // pane that scrolls too. On a phone there is only ever one
                      // of them on screen, so the page keeps scrolling normally.
                      "md:overflow-hidden md:pb-0"
                    : "md:pb-[max(1.5rem,var(--spacing-safe-bottom))]"
                )}
              >
                {fullBleed ? (
                  <div className="flex w-full flex-col md:h-full md:min-h-0">
                    <MobilePageTitle />
                    {children}
                  </div>
                ) : (
                  <div className="mx-auto w-full max-w-6xl pt-1 pr-[max(1rem,var(--spacing-safe-right))] pb-6 pl-[max(1rem,var(--spacing-safe-left))] md:pt-4 md:pr-[max(1.5rem,var(--spacing-safe-right))] md:pl-[max(1.5rem,var(--spacing-safe-left))]">
                    <MobilePageTitle />
                    {children}
                  </div>
                )}
              </div>
            </div>

            <MobileTabBar />
          </SidebarInset>
        </ScrollPaneProvider>
        <AssistantPanel />
      </AssistantPanelProvider>
    </SidebarProvider>
  )
}
