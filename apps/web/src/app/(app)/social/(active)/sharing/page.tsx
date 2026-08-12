import { getExtracted } from "next-intl/server"
import { PageMeta } from "@/components/shell/page-chrome"
import { SharingClient } from "./sharing-client"

export default async function SocialSharingPage() {
  const t = await getExtracted()
  return (
    <>
      <PageMeta title={t("Sharing")} />
      <SharingClient />
    </>
  )
}
