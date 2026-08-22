"use client"

import {
  CalendarDaysIcon,
  CheckSquare2Icon,
  LayoutDashboardIcon,
  NotebookTabsIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { SectionNav } from "@/components/shell/section-nav"

/**
 * The four planning screens.
 *
 * Same shape as social and admin, from the same component: a rail beside the
 * content on a wide screen, a scrolling row of pills above it on a phone. It
 * used to be a row of filled pills in a bordered card, in the flow of the page —
 * a third pattern for a job the app had already solved twice.
 */
export function PlanningNavigation() {
  const t = useExtracted()

  return (
    <SectionNav
      title={t("Planning")}
      label={t("Planning sections")}
      groups={[
        {
          items: [
            {
              href: "/planning",
              label: t("Overview"),
              icon: LayoutDashboardIcon,
              exact: true,
            },
            {
              href: "/planning/agenda",
              label: t("Class agenda"),
              icon: NotebookTabsIcon,
            },
            {
              href: "/planning/tasks",
              label: t("Tasks"),
              icon: CheckSquare2Icon,
            },
            {
              href: "/planning/calendar",
              label: t("Calendar"),
              icon: CalendarDaysIcon,
            },
          ],
        },
      ]}
    />
  )
}
