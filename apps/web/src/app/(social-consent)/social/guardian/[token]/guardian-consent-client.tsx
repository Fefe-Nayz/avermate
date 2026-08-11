"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { UserRoundCheckIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  ConsentCheck,
  PrivacyNote,
  SocialCallout,
  SocialFlow,
  SocialHeading,
  SocialOutcome,
  SocialSection,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"

type GuardianPreview = {
  valid: true
  requestId: string
  requestCode: string
  policyVersion: "2026-08-11.1"
  expiresAt: Date
  createdAt: Date
  assurances: {
    emailVerified: true
    requiresAdultAttestation: true
    requiresParentalAuthorityAttestation: true
  }
}

/**
 * A guardian deciding.
 *
 * The reader is often not an Avermate user and has one question: what am I
 * agreeing to. So the page states what approval permits before it asks for
 * anything, and says plainly what it does not reveal — this screen shows no
 * marks, no subjects, no dates and not even the young person's email.
 */
export function GuardianConsentClient({
  token,
  preview,
}: {
  token: string
  preview: GuardianPreview
}) {
  const t = useExtracted()
  const [isAdult, setIsAdult] = useState(false)
  const [hasAuthority, setHasAuthority] = useState(false)
  const [outcome, setOutcome] = useState<"accepted" | "declined" | null>(null)

  const accept = useMutation({
    ...orpc.social.guardian.accept.mutationOptions(),
    onSuccess: () => setOutcome("accepted"),
  })
  const decline = useMutation({
    ...orpc.social.guardian.decline.mutationOptions(),
    onSuccess: () => setOutcome("declined"),
  })
  const busy = accept.isPending || decline.isPending

  useEffect(() => {
    window.history.replaceState(window.history.state, "", "/settings/social")
  }, [])

  if (outcome) {
    return (
      <SocialFlow className="py-6">
        <PageMeta title={t("Guardian consent")} />
        <SocialOutcome
          tone={outcome === "accepted" ? "positive" : "neutral"}
          title={
            outcome === "accepted"
              ? t("Your approval is recorded")
              : t("Request declined")
          }
          action={
            <Button render={<Link href="/" />}>{t("Return to Avermate")}</Button>
          }
        >
          {outcome === "accepted"
            ? t(
                "The young person still controls their own choice and can turn social sharing off at any time."
              )
            : t(
                "Social access stays off. Grades, goals and school analytics are unaffected."
              )}
        </SocialOutcome>
      </SocialFlow>
    )
  }

  return (
    <SocialFlow className="py-6">
      <PageMeta title={t("Guardian consent")} />

      <SocialHeading
        icon={UserRoundCheckIcon}
        title={t("A guardian approval request")}
        description={t(
          "A young person asked to use Avermate's optional friends and groups features. This page shows you none of their marks, subjects, comments, dates or account email."
        )}
      />

      <SocialCallout tone="positive" title={t("What approval permits")}>
        {t(
          "A sign-in-only, invite-based social profile. Every profile field still needs an explicit permission, group comparisons are aggregate-only by default, and named rankings need a further opt-in."
        )}
      </SocialCallout>

      <SocialSection
        title={t("Request code")}
        description={t(
          "Not a secret. Compare it with the code shown to the young person to be sure you are looking at the same request."
        )}
      >
        <p className="font-mono text-2xl font-semibold tracking-[0.3em]">
          {preview.requestCode}
        </p>
      </SocialSection>

      <div className="flex flex-col gap-2">
        <ConsentCheck checked={isAdult} onCheckedChange={setIsAdult}>
          <span className="font-medium">{t("I am an adult.")}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("The server also requires a verified account email.")}
          </span>
        </ConsentCheck>
        <ConsentCheck checked={hasAuthority} onCheckedChange={setHasAuthority}>
          <span className="font-medium">
            {t("I have parental authority for this young person.")}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("Do not approve if this is not true.")}
          </span>
        </ConsentCheck>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("Sharing policy version")} {preview.policyVersion}.{" "}
        <Link
          href="/legal/social-sharing"
          className="underline underline-offset-4"
        >
          {t("Read the plain-language summary")}
        </Link>
      </p>

      {accept.error || decline.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(
            "This request could not be completed. It may be expired, already used, or linked to another verified account."
          )}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => decline.mutate({ token })}
        >
          {decline.isPending ? <Spinner /> : null}
          {t("Decline")}
        </Button>
        <Button
          disabled={busy || !isAdult || !hasAuthority}
          onClick={() =>
            accept.mutate({
              token,
              acceptedPolicyVersion: preview.policyVersion,
              isAdult: true,
              hasParentalAuthority: true,
            })
          }
        >
          {accept.isPending ? <Spinner /> : null}
          {t("Approve social access")}
        </Button>
      </div>

      <PrivacyNote />
    </SocialFlow>
  )
}
