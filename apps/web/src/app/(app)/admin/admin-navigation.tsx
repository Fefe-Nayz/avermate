"use client"

import { useExtracted } from "next-intl"
import {
  FlagIcon,
  LayersIcon,
  LayoutGridIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  ScrollTextIcon,
  ServerCogIcon,
  ShieldIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react"
import { SectionNav } from "@/components/shell/section-nav"

/**
 * Where you are in administration.
 *
 * The section had no navigation at all: every page arrived through a link
 * somewhere else and offered no way across to its siblings, so moving from
 * users to feedback meant going back to the index each time. Social is the
 * worst of it — four pages deep with nothing tying them together — so it is
 * grouped rather than flattened into a list of eight peers.
 *
 * A rail on a wide screen and a scrolling row of pills on a phone — the same
 * shape social uses, from one component so the two cannot drift apart. The
 * rail alone left every one of these nine pages unreachable below `md`: the
 * back arrow only retraces the way in, so a phone could not cross from users
 * to feedback at all.
 *
 * The pills flatten the groups. A row that scrolls sideways has no room for
 * headings, and "Social › Overview" beside the top-level "Overview" would be
 * two identical pills, so the grouped labels are folded into the item names.
 */
export function AdminNavigation() {
  const t = useExtracted()

  return (
    <SectionNav
      label={t("Administration sections")}
      groups={[
        {
          items: [
            {
              href: "/admin",
              label: t("Overview"),
              icon: LayersIcon,
              exact: true,
            },
            { href: "/admin/users", label: t("Users"), icon: UsersIcon },
            {
              href: "/admin/feedback",
              label: t("Feedback"),
              icon: MessageSquareIcon,
            },
            {
              href: "/admin/announcements",
              label: t("Announcements"),
              icon: MegaphoneIcon,
            },
            {
              href: "/admin/presets",
              label: t("Curriculum presets"),
              icon: ScrollTextIcon,
            },
            {
              href: "/admin/managed",
              label: t("Managed service"),
              icon: ServerCogIcon,
            },
            {
              href: "/admin/card-templates",
              label: t("Card gallery"),
              icon: LayoutGridIcon,
            },
          ],
        },
        {
          label: t("Social"),
          items: [
            {
              href: "/admin/social",
              label: t("Overview"),
              icon: ShieldIcon,
              exact: true,
            },
            {
              href: "/admin/social/reports",
              label: t("Reports"),
              icon: FlagIcon,
            },
            {
              href: "/admin/social/groups",
              label: t("Classes"),
              icon: UsersRoundIcon,
            },
          ],
        },
      ]}
    />
  )
}
