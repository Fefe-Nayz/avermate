import { getExtracted } from "next-intl/server"
import { PageMeta } from "@/components/shell/page-chrome"
import { FriendDetailClient } from "./friend-detail-client"

export default async function FriendDetailPage({
  params,
}: {
  params: Promise<{ friendshipId: string }>
}) {
  const t = await getExtracted()
  const { friendshipId } = await params
  return (
    <>
      <PageMeta title={t("Friend")} />
      <FriendDetailClient friendshipId={friendshipId} />
    </>
  )
}
