"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRightIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { SOCIAL_INVITATION_RETURN_KEY } from "@/components/social/invitation-setup-gate"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  parseSocialInvitationHandoff,
  serializeSocialInvitationHandoff,
  socialInvitationFromLegacyPath,
  type SocialInvitationKind,
} from "@/lib/social-invitation"

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
    <Card className="border-primary/30 bg-primary/5 py-3">
      <CardContent className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">
            {t("Your private invitation is ready")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              "Return to the preserved invitation to review it before accepting."
            )}
          </p>
        </div>
        <Button
          onClick={() => {
            router.push("/social/invitation/review")
          }}
        >
          {t("Return to invitation")} <ArrowRightIcon />
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            sessionStorage.removeItem(SOCIAL_INVITATION_RETURN_KEY)
            setKind(null)
          }}
        >
          {t("Discard")}
        </Button>
      </CardContent>
    </Card>
  )
}
