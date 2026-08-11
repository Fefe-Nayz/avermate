import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { getServerOrpc } from "@/lib/orpc/server"
import { getServerQueryClient } from "@/lib/query-server"
import { socialAppIsAccessible } from "@/lib/social-access"

export default async function FriendsSocialLayout({
  children,
}: {
  children: ReactNode
}) {
  const eligibility = await getServerQueryClient().fetchQuery(
    getServerOrpc().social.eligibility.get.queryOptions()
  )
  if (!socialAppIsAccessible(eligibility)) redirect("/settings/social")
  return children
}
