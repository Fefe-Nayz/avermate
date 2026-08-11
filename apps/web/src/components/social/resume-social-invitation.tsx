"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRightIcon, MailOpenIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { SOCIAL_INVITATION_RETURN_KEY } from "@/components/social/invitation-setup-gate"
import { SocialCallout } from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import {
  parseSocialInvitationHandoff,
  serializeSocialInvitationHandoff,
  socialInvitationFromLegacyPath,
  type SocialInvitationKind,
} from "@/lib/social-invitation"

/**
 * The invitation you set aside is now openable.
 *
 * It appears only once the account can actually act on it, so it is an
 * offer rather than a nag — and discarding it is one click away.
 */
export function ResumeSocialInvitation({
  groupReady,
  friendReady,
}: {
  groupReady: boolean
  friendReady: boolean
}) {
  const t = useExtracted()
  const router = useRouter()
  const [kind, setKind] = useState<SocialInvitationKind | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem(SOCIAL_INVITATION_RETURN_KEY)
    const currentHandoff = parseSocialInvitationHandoff(stored)
    const legacyInvitation = currentHandoff
      ? null
      : socialInvitationFromLegacyPath(stored)
    const safe = currentHandoff ?? legacyInvitation
    if (!safe) {
      if (stored) sessionStorage.removeItem(SOCIAL_INVITATION_RETURN_KEY)
      queueMicrotask(() => setKind(null))
      return
    }
    if (legacyInvitation) {
      sessionStorage.setItem(
        SOCIAL_INVITATION_RETURN_KEY,
        serializeSocialInvitationHandoff(legacyInvitation)
      )
    }
    queueMicrotask(() => setKind(safe.kind))
  }, [])

  if (!kind) return null
  const isFriend = kind === "friend"
  if ((isFriend && !friendReady) || (!isFriend && !groupReady)) return null

  return (
    <SocialCallout
      tone="positive"
      icon={MailOpenIcon}
      title={
        isFriend
          ? t("Your friend invitation is ready")
          : t("Your group invitation is ready")
      }
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => router.push("/social/invitation/review")}
          >
            {t("Open it")} <ArrowRightIcon />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              sessionStorage.removeItem(SOCIAL_INVITATION_RETURN_KEY)
              setKind(null)
            }}
          >
            {t("Discard")}
          </Button>
        </div>
      }
    >
      {t("It was held on this device while you set up social access.")}
    </SocialCallout>
  )
}
