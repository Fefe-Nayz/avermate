import Link from "next/link"
import {
  CirclePauseIcon,
  InfoIcon,
  LockKeyholeIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  UserRoundCheckIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { SocialEligibilityView } from "@/lib/social-access"

export function EligibilityState({
  eligibility,
  settingsHref = "/settings/social",
}: {
  eligibility: SocialEligibilityView
  settingsHref?: string
}) {
  const t = useExtracted()

  if (!eligibility.enabled || eligibility.status === "feature_disabled") {
    return (
      <Alert>
        <CirclePauseIcon aria-hidden />
        <AlertTitle>{t("Social features are unavailable")}</AlertTitle>
        <AlertDescription>
          {t(
            "The social feature flag is off. Your grade tracker, analytics and goals continue to work normally."
          )}
        </AlertDescription>
      </Alert>
    )
  }

  if (eligibility.status === "age_unknown") {
    return (
      <Alert>
        <InfoIcon aria-hidden />
        <AlertTitle>{t("A private eligibility step is required")}</AlertTitle>
        <AlertDescription>
          <p>
            {t(
              "Avermate only needs an age range, not your birth date. Social navigation stays hidden until you make a choice."
            )}
          </p>
          <Button
            size="sm"
            className="mt-3"
            render={<Link href={settingsHref} />}
          >
            {t("Review social eligibility")}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (
    eligibility.status === "guardian_required" ||
    eligibility.status === "verification_expired"
  ) {
    return (
      <Alert className="border-amber-500/30 bg-amber-500/5">
        <UserRoundCheckIcon aria-hidden />
        <AlertTitle>
          {t("Child and guardian approval are both required")}
        </AlertTitle>
        <AlertDescription>
          <p>
            {t(
              "For an account under 15, social sharing remains off until the child chooses to participate and a guardian verification is recorded. Refusing or stopping does not affect school tracking."
            )}
          </p>
          <Button
            size="sm"
            className="mt-3"
            render={<Link href={settingsHref} />}
          >
            {t("Open the guardian step")}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (eligibility.status === "consent_required") {
    return (
      <Alert>
        <LockKeyholeIcon aria-hidden />
        <AlertTitle>{t("Social sharing is still off")}</AlertTitle>
        <AlertDescription>
          <p>
            {t(
              "Review what friends and groups can request before enabling a profile. Nothing is shared merely because the account is eligible."
            )}
          </p>
          <Button
            size="sm"
            className="mt-3"
            render={<Link href={settingsHref} />}
          >
            {t("Review and choose")}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (
    eligibility.status === "frozen" ||
    eligibility.profileStatus === "frozen"
  ) {
    return (
      <Alert variant="destructive">
        <ShieldAlertIcon aria-hidden />
        <AlertTitle>{t("Social access is temporarily restricted")}</AlertTitle>
        <AlertDescription>
          {t(
            "Your school data remains available. Social profiles, requests and group views stay unavailable while this restriction is reviewed."
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert className="border-emerald-500/30 bg-emerald-500/5">
      <ShieldCheckIcon aria-hidden />
      <AlertTitle>{t("Social sharing is active")}</AlertTitle>
      <AlertDescription>
        {t(
          "Only fields covered by an active grant or group consent can appear. You can preview and withdraw access at any time."
        )}
      </AlertDescription>
    </Alert>
  )
}
