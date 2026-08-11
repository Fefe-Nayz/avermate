"use client"

import { useLayoutEffect } from "react"
import { useExtracted } from "next-intl"
import { Spinner } from "@/components/ui/spinner"
import {
  GUARDIAN_CONSENT_HANDOFF_KEY,
  parseGuardianConsentFragment,
  serializeGuardianConsentHandoff,
} from "@/lib/social-invitation"

/** Preserves the fragment across sign-in without putting it in an HTTP URL. */
export function GuardianConsentBridge() {
  const t = useExtracted()

  useLayoutEffect(() => {
    const token = parseGuardianConsentFragment(window.location.hash)
    window.history.replaceState(window.history.state, "", "/social/guardian")
    const handoff = token ? serializeGuardianConsentHandoff(token) : null
    if (handoff) {
      sessionStorage.setItem(GUARDIAN_CONSENT_HANDOFF_KEY, handoff)
    } else {
      sessionStorage.removeItem(GUARDIAN_CONSENT_HANDOFF_KEY)
    }
    window.location.replace("/social/guardian/review")
  }, [])

  return (
    <main
      className="grid min-h-svh place-items-center bg-background"
      aria-label={t("Loading request")}
    >
      <Spinner />
    </main>
  )
}
