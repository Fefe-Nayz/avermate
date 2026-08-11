import type { Metadata } from "next"
import { SocialInvitationBridge } from "./social-invitation-bridge"

export const metadata: Metadata = {
  title: "Private social invitation",
  description: "Open a private Avermate social invitation.",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
}

export default function SocialInvitationBridgePage() {
  return <SocialInvitationBridge />
}
