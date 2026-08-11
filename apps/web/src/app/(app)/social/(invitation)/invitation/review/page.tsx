import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SocialInvitationReviewClient } from "./social-invitation-review-client"
import { getServerRpc } from "@/lib/orpc/server"

export const metadata: Metadata = {
  title: "Private social invitation",
  description: "Review a private Avermate social invitation.",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
}

export default async function SocialInvitationReviewPage() {
  const eligibility = await getServerRpc().social.eligibility.get()
  if (!eligibility.enabled) notFound()

  return <SocialInvitationReviewClient />
}
