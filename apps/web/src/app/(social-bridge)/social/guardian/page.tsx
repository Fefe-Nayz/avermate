import type { Metadata } from "next"
import { GuardianConsentBridge } from "./guardian-consent-bridge"

export const metadata: Metadata = {
  title: "Guardian consent",
  description: "Open a private Avermate guardian consent request.",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
}

export default function GuardianConsentBridgePage() {
  return <GuardianConsentBridge />
}
