import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { FriendInvitationClient } from "./friend-invitation-client"
import { InvitationSetupGate } from "@/components/social/invitation-setup-gate"
import { getServerRpc } from "@/lib/orpc/server"
import { socialAppIsAccessible } from "@/lib/social-access"

export const metadata: Metadata = {
  title: "Private friend invitation",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
}

export default async function FriendInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token || token.length > 256) notFound()
  const rpc = getServerRpc()
  const eligibility = await rpc.social.eligibility.get()
  if (!eligibility.enabled) notFound()
  if (!socialAppIsAccessible(eligibility)) {
    return (
      <InvitationSetupGate
        invitation={{ kind: "friend", token }}
        friendProfileRequired
      />
    )
  }

  const preview = await rpc.social.friends.invitations
    .preview({ token })
    .catch(() => null)
  if (!preview) notFound()

  return <FriendInvitationClient token={token} preview={preview} />
}
