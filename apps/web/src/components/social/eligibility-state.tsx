"use client"

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
import { SocialCallout } from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import type { SocialEligibilityView } from "@/lib/social-access"

/**
 * Why social is, or is not, available.
 *
 * Each of these states is a different reason with a different way out, and the
 * old version drew them all as the same grey alert with the same grey button.
 * The one that most needs distinguishing is a restriction under review, which
 * nobody can act on — it is the only one that carries no next step.
 */
export function EligibilityState({
  eligibility,
  settingsHref = "/settings/social",
}: {
  eligibility: SocialEligibilityView
  settingsHref?: string
}) {
  const t = useExtracted()

  const go = (label: string) => (
    <Button size="sm" render={<Link href={settingsHref} />}>
      {label}
    </Button>
  )

  if (!eligibility.enabled || eligibility.status === "feature_disabled") {
    return (
      <SocialCallout
        icon={CirclePauseIcon}
        title={t("Social features are unavailable")}
      >
        {t(
          "The feature is switched off for this instance. Your grade tracker, analytics and goals are unaffected."
        )}
      </SocialCallout>
    )
  }

  if (eligibility.status === "age_unknown") {
    return (
      <SocialCallout
        icon={InfoIcon}
        title={t("One eligibility question first")}
        action={go(t("Answer it"))}
      >
        {t(
          "Avermate asks for an age range, never a birth date. Nothing social appears until you answer."
        )}
      </SocialCallout>
    )
  }

  if (
    eligibility.status === "guardian_required" ||
    eligibility.status === "verification_expired"
  ) {
    return (
      <SocialCallout
        tone="caution"
        icon={UserRoundCheckIcon}
        title={t("Two people have to agree")}
        action={go(t("Open the guardian step"))}
      >
        {t(
          "Under 15, social sharing stays off until the young person chooses it and a verified guardian agrees. Refusing or stopping blocks no school feature."
        )}
      </SocialCallout>
    )
  }

  if (eligibility.status === "consent_required") {
    return (
      <SocialCallout
        icon={LockKeyholeIcon}
        title={t("Social sharing is still off")}
        action={go(t("Review and choose"))}
      >
        {t(
          "Read what friends and groups can ask for before enabling a profile. Being eligible shares nothing by itself."
        )}
      </SocialCallout>
    )
  }

  if (
    eligibility.status === "frozen" ||
    eligibility.profileStatus === "frozen"
  ) {
    return (
      <SocialCallout
        tone="danger"
        icon={ShieldAlertIcon}
        title={t("Social access is temporarily restricted")}
      >
        {t(
          "Your school data stays available. Profiles, requests and group views are unavailable while this is reviewed."
        )}
      </SocialCallout>
    )
  }

  return (
    <SocialCallout
      tone="positive"
      icon={ShieldCheckIcon}
      title={t("Social sharing is active")}
    >
      {t(
        "Only fields covered by a permission or a group consent can appear. You can preview and withdraw at any time."
      )}
    </SocialCallout>
  )
}
