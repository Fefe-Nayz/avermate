import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { GroupInvitationClient } from "./group-invitation-client"
import { InvitationSetupGate } from "@/components/social/invitation-setup-gate"
import { getServerRpc } from "@/lib/orpc/server"
import { socialGroupIsAccessible } from "@/lib/social-access"

export const metadata: Metadata = {
  title: "Private group invitation",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
}

export default async function GroupInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token || token.length > 256) notFound()
  const rpc = getServerRpc()
  const eligibility = await rpc.social.eligibility.get()
  if (!eligibility.enabled) notFound()
  if (!socialGroupIsAccessible(eligibility)) {
    return (
      <InvitationSetupGate
        invitation={{ kind: "group", token }}
        friendProfileRequired={false}
      />
    )
  }

  const preview = await rpc.social.groups.invitations
    .preview({ token })
    .catch(() => null)
  if (!preview) notFound()

  return <GroupInvitationClient token={token} preview={preview} />
}
