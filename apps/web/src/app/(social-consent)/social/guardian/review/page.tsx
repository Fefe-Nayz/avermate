import type { Metadata } from "next"
import { GuardianConsentReviewClient } from "./guardian-consent-review-client"
import { requireServerViewer } from "@/lib/authenticated-data"

export const metadata: Metadata = {
  title: "Guardian consent",
  description: "Review a private Avermate guardian consent request.",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
}

export default async function GuardianConsentReviewPage() {
  await requireServerViewer()
  return <GuardianConsentReviewClient />
}
