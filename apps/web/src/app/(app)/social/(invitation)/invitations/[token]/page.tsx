import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { GroupInvitationClient } from "./group-invitation-client"

export const metadata: Metadata = {
  title: "Class invitation",
  robots: { index: false, follow: false },
}

export default async function GroupInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token) notFound()
  return <GroupInvitationClient token={token} />
}
