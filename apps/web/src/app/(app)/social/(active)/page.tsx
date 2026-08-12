import { getExtracted } from "next-intl/server"
import { PageMeta } from "@/components/shell/page-chrome"
import { FriendsClient } from "./friends-client"

/**
 * Social opens on the people. Everything about one friend — including the
 * averages they share — is one click deeper.
 */
export default async function SocialPage() {
  const t = await getExtracted()
  return (
    <>
      <PageMeta title={t("Friends")} />
      <FriendsClient />
    </>
  )
}
