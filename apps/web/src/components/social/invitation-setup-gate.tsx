"use client"

import { useRouter } from "next/navigation"
import { ShieldCheckIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  serializeSocialInvitationHandoff,
  socialInvitationFromLegacyPath,
  type SocialInvitationSecret,
} from "@/lib/social-invitation"

export const SOCIAL_INVITATION_RETURN_KEY = "avermate:social-invitation-return"

export function safeSocialInvitationPath(value: string | null): string | null {
  return socialInvitationFromLegacyPath(value) ? value : null
}

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
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>{t("Set up social consent first")}</CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {friendProfileRequired
            ? t(
                "This private friend invitation is preserved on this device while you review eligibility, consent and an invite-only profile."
              )
            : t(
                "This private group invitation is preserved on this device while you review eligibility and consent. Friend discovery does not need to be enabled."
              )}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <ShieldCheckIcon aria-hidden />
          <AlertTitle>{t("The invitation stays private")}</AlertTitle>
          <AlertDescription>
            {t(
              "The secret remains in device session storage instead of being copied into a settings URL or referrer. You can refuse social consent without affecting school features."
            )}
          </AlertDescription>
        </Alert>
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
          {t("Review social setup")}
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
      </CardContent>
    </Card>
  )
}
