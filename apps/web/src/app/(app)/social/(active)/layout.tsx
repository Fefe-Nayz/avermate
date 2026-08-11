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

  return (
    <div className="flex flex-col gap-4">
      <SocialNavigation />
      {children}
    </div>
  )
}
