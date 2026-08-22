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
import { useQuickAddActions } from "./quick-add"
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
  /**
   * The one thing this sidebar can *create*, if the account asked for one.
   *
   * Off by default, and deliberately: a sidebar is for going places, and a button
   * that makes something is a different kind of thing to put among them. But the
   * commonest act in this app is recording a grade, and reaching it through the
   * quick-add sheet is two gestures for something done several times a week — so an
   * account that wants it can have it, and can choose which of the six it is.
   */
  const action = useQuickAddActions().find(
    (candidate) => candidate.href === preferences.navigation.sidebarAction
  )
  const secondary = NAV_ENTRIES.filter(
    (entry) =>
      (!entry.adminOnly || isAdmin) &&
      ["/review", "/admin"].includes(entry.href)
  )

  const labels: Record<string, string> = {
    Dashboard: t("Dashboard"),
    Subjects: t("Subjects"),
    Grades: t("Grades"),
    Materials: t("Materials"),
    Goals: t("Goals"),
    Planning: t("Planning"),
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
              {/* Above the places, not among them, and filled rather than quiet:
                  the one item here that does something instead of going
                  somewhere should not have to be read to be told apart. It
                  collapses to its icon with everything else, so the rail keeps
                  working. */}
              {action ? (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={action.addLabel}
                    className="mb-1 bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                    onClick={() => haptic("light")}
                    render={<Link href={action.href} />}
                  >
                    <action.icon />
                    <span>{action.addLabel}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
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
