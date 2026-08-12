import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { FriendInvitationClient } from "./friend-invitation-client"

export const metadata: Metadata = {
  title: "Friend invitation",
  robots: { index: false, follow: false },
}

export default async function FriendInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token) notFound()
  return <FriendInvitationClient token={token} />
}
