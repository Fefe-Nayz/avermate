import { getExtracted } from "next-intl/server"
import { PageMeta } from "@/components/shell/page-chrome"
import { GroupsClient } from "./groups-client"

export default async function SocialGroupsPage() {
  const t = await getExtracted()
  return (
    <>
      <PageMeta title={t("Classes")} />
      <GroupsClient />
    </>
  )
}
