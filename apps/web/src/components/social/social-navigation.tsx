"use client"

import {
  BellIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { SectionNav } from "@/components/shell/section-nav"

/**
 * Where you are in social: friends, classes, your locks, and what happened.
 * The shape is `SectionNav`, shared with planning and admin, so the three areas
 * cannot drift apart the way they had.
 */
export function SocialNavigation() {
  const t = useExtracted()

  return (
    <SectionNav
      title={t("Social")}
      label={t("Social sections")}
      groups={[
        {
          items: [
            {
              href: "/social",
              label: t("Friends"),
              icon: UserRoundIcon,
              exact: true,
              // The friend detail pages live under their own segment, and the
              // rail should stay on "Friends" while you are reading one.
              alsoMatches: ["/social/friends"],
            },
            {
              href: "/social/groups",
              label: t("Classes"),
              icon: UsersRoundIcon,
            },
            {
              href: "/social/sharing",
              label: t("Sharing"),
              icon: ShieldCheckIcon,
            },
            {
              href: "/social/notifications",
              label: t("Updates"),
              icon: BellIcon,
            },
          ],
        },
      ]}
    />
  )
}
