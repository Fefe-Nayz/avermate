import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import type { ReactNode } from "react"
import { SocialNavigation } from "@/components/social/social-navigation"
import { getServerOrpc } from "@/lib/orpc/server"
import { getServerQueryClient } from "@/lib/query-server"
import {
  socialGroupIsAccessible,
  socialFeatureIsKnown,
} from "@/lib/social-access"

export const metadata: Metadata = {
  title: "Social",
  description: "Private friend and group sharing in Avermate.",
  robots: { index: false, follow: false },
}

/** Fail closed without covering guardian and invitation consent routes. */
export default async function ActiveSocialLayout({
  children,
}: {
  children: ReactNode
}) {
  const eligibility = await getServerQueryClient().fetchQuery(
    getServerOrpc().social.eligibility.get.queryOptions()
  )

  if (!socialFeatureIsKnown(eligibility)) notFound()
  if (!socialGroupIsAccessible(eligibility)) redirect("/settings/social")

  // The rail sits beside the content on a wide screen; the pill row it also
  // renders stacks above it on a phone. Both come out of one component, so the
  // two layouts cannot drift apart.
  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-8">
      <SocialNavigation />
      <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
    </div>
  )
}
