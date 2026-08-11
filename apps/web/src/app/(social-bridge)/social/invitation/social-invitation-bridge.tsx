"use client"

import { useLayoutEffect } from "react"
import { useExtracted } from "next-intl"
import { SOCIAL_INVITATION_RETURN_KEY } from "@/components/social/invitation-setup-gate"
import { Spinner } from "@/components/ui/spinner"
import {
  parseSocialInvitationFragment,
  serializeSocialInvitationHandoff,
} from "@/lib/social-invitation"

/** Captures a client-only fragment before any authenticated server redirect. */
export function SocialInvitationBridge() {
  const t = useExtracted()

  useLayoutEffect(() => {
    const invitation = parseSocialInvitationFragment(window.location.hash)
    window.history.replaceState(window.history.state, "", "/social/invitation")
    if (invitation) {
      sessionStorage.setItem(
        SOCIAL_INVITATION_RETURN_KEY,
        serializeSocialInvitationHandoff(invitation)
      )
    } else {
      sessionStorage.removeItem(SOCIAL_INVITATION_RETURN_KEY)
    }
    window.location.replace("/social/invitation/review")
  }, [])

  return (
    <main
      className="grid min-h-svh place-items-center bg-background"
      aria-label={t("Loading invitation")}
    >
      <Spinner />
    </main>
  )
}
