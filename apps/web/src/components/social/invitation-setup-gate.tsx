"use client"

import { useRouter } from "next/navigation"
import { ArrowRightIcon, LockKeyholeIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import {
  SocialActions,
  SocialCallout,
  SocialFlow,
  SocialSection,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import {
  serializeSocialInvitationHandoff,
  socialInvitationFromLegacyPath,
  type SocialInvitationSecret,
} from "@/lib/social-invitation"

export const SOCIAL_INVITATION_RETURN_KEY = "avermate:social-invitation-return"

export function safeSocialInvitationPath(value: string | null): string | null {
  return socialInvitationFromLegacyPath(value) ? value : null
}

/**
 * The invitation is valid; the account is not ready for it yet.
 *
 * The link is held on the device rather than carried through a settings URL,
 * which is the safe choice and also an invisible one — so it is said out loud,
 * next to a button that discards it. Someone who does not want social access
 * should be able to refuse without hunting for how.
 */
export function InvitationSetupGate({
  invitation,
  returnTo,
  friendProfileRequired,
}: {
  invitation?: SocialInvitationSecret
  /** Compatibility for previously issued path-token links only. */
  returnTo?: string
  friendProfileRequired: boolean
}) {
  const t = useExtracted()
  const router = useRouter()

  return (
    <SocialFlow>
      <SocialSection
        icon={LockKeyholeIcon}
        title={t("Set up social consent first")}
        description={
          friendProfileRequired
            ? t(
                "This friend invitation is held on this device while you review eligibility, consent and an invite-only profile."
              )
            : t(
                "This group invitation is held on this device while you review eligibility and consent. Friend discovery does not need to be on."
              )
        }
        footer={
          <SocialActions>
            <Button
              onClick={() => {
                const safe =
                  invitation ?? socialInvitationFromLegacyPath(returnTo ?? null)
                if (!safe) return
                sessionStorage.setItem(
                  SOCIAL_INVITATION_RETURN_KEY,
                  serializeSocialInvitationHandoff(safe)
                )
                router.replace("/settings/social")
              }}
            >
              {t("Review social setup")} <ArrowRightIcon />
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                sessionStorage.removeItem(SOCIAL_INVITATION_RETURN_KEY)
                router.replace("/settings/social")
              }}
            >
              {t("Discard invitation")}
            </Button>
          </SocialActions>
        }
      >
        <SocialCallout tone="positive" title={t("The secret stays private")}>
          {t(
            "It is kept in this device's session storage instead of being copied into a settings URL or a referrer. Refusing social consent affects no school feature."
          )}
        </SocialCallout>
      </SocialSection>
    </SocialFlow>
  )
}
