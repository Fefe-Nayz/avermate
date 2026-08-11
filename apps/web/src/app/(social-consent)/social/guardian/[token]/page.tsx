import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { GuardianConsentClient } from "./guardian-consent-client"
import { requireServerViewer } from "@/lib/authenticated-data"
import { getServerRpc } from "@/lib/orpc/server"

export const metadata: Metadata = {
  title: "Guardian consent",
  description: "Review a private Avermate guardian consent request.",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
}

export default async function GuardianConsentPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  await requireServerViewer()
  const { token } = await params
  if (!token || token.length > 512) notFound()

  const preview = await getServerRpc()
    .social.guardian.preview({ token })
    .catch(() => null)
  if (!preview?.valid) notFound()

  return <GuardianConsentClient token={token} preview={preview} />
}
