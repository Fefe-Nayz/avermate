import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { GroupDetailClient } from "./group-detail-client"

export const metadata: Metadata = {
  title: "Class",
  robots: { index: false, follow: false },
}

export default async function SocialGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  if (!groupId) notFound()
  return <GroupDetailClient groupId={groupId} />
}
