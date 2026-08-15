"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useExtracted } from "next-intl"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  DEFAULT_SIDEBAR_HREFS,
  isActivePath,
  NAV_ENTRIES,
  sanitizeNavSelection,
} from "@/lib/nav"
import { usePreferences } from "@/hooks/use-preferences"
import type { AuthenticatedUser } from "@/lib/authenticated-user"
import { NavUser } from "./nav-user"
import { YearSwitcher } from "./year-switcher"
import { SidebarSubjectTree } from "./sidebar-subject-tree"
import { haptic } from "@/lib/haptics"
import { useIsAdmin } from "@/hooks/use-admin"

export function AppSidebar({ user }: { user: AuthenticatedUser }) {
  const t = useExtracted()
  const pathname = usePathname()
  // An account can administer the site through ADMIN_USER_IDS without its
  // role column saying so, so the server is the one that answers this.
  const { isAdmin } = useIsAdmin()

  const { preferences } = usePreferences()

  // Two groups rather than one long list: the first is the year you are
  // living in — in the order (and selection) the account chose in
  // Settings → Navigation — the second is everything you occasionally
  // reach for.
  const primary = sanitizeNavSelection(
    preferences.navigation.sidebar,
    DEFAULT_SIDEBAR_HREFS
  ).flatMap((href) => {
    const entry = NAV_ENTRIES.find(
      (candidate) => candidate.href === href && !candidate.adminOnly
    )
    return entry ? [entry] : []
  })
  const secondary = NAV_ENTRIES.filter(
    (entry) =>
      (!entry.adminOnly || isAdmin) &&
      ["/review", "/admin"].includes(entry.href)
  )

  const labels: Record<string, string> = {
    Dashboard: t("Dashboard"),
    Subjects: t("Subjects"),
    Grades: t("Grades"),
    Goals: t("Goals"),
    Insights: t("Insights"),
    Social: t("Social"),
    "Year in review": t("Year in review"),
    Admin: t("Admin"),
  }

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <YearSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {primary.map((entry) => (
                <SidebarMenuItem key={entry.href}>
                  <SidebarMenuButton
                    isActive={isActivePath(pathname, entry)}
                    tooltip={labels[entry.label]}
                    onClick={() => haptic("selection")}
                    render={<Link href={entry.href} />}
                  >
                    <entry.icon />
                    <span>{labels[entry.label]}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSubjectTree />

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>{t("More")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {secondary.map((entry) => (
                <SidebarMenuItem key={entry.href}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={isActivePath(pathname, entry)}
                    tooltip={labels[entry.label]}
                    render={<Link href={entry.href} />}
                  >
                    <entry.icon />
                    <span>{labels[entry.label]}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
