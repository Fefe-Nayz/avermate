"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { CheckCircle2Icon, ShieldCheckIcon, XCircleIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { PageMeta } from "@/components/shell/page-chrome"
import { PrivacyBoundaryNotice } from "@/components/social/social-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-6">
        <PageMeta title={t("Guardian consent")} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {outcome === "accepted" ? (
                <CheckCircle2Icon className="text-success" />
              ) : (
                <XCircleIcon className="text-muted-foreground" />
              )}
              {outcome === "accepted"
                ? t("Guardian choice recorded")
                : t("Request declined")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              {outcome === "accepted"
                ? t(
                    "Your approval is recorded. The child still controls their own choice and can withdraw social sharing at any time."
                  )
                : t(
                    "Social access remains off. This does not block grades, goals or school analytics."
                  )}
            </p>
            <Button render={<Link href="/" />}>
              {t("Return to Avermate")}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-6">
      <PageMeta title={t("Guardian consent")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("Review a guardian consent request")}</CardTitle>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(
              "A young person chose to request Avermate's optional friends and groups features. This page does not reveal their notes, subjects, comments, dates or account email."
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <Alert>
            <ShieldCheckIcon aria-hidden />
            <AlertTitle>{t("What approval allows")}</AlertTitle>
            <AlertDescription>
              {t(
                "An authenticated-only, invite-based social profile. Each profile field still requires an explicit audience grant. Group academic comparisons are aggregate-only by default, and named rankings require a separate opt-in."
              )}
            </AlertDescription>
          </Alert>

          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="text-xs font-medium text-muted-foreground">
              {t("Request code")}
            </p>
            <p className="font-mono text-xl font-semibold tracking-widest">
              {preview.requestCode}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                "This code is not a secret. Compare it with the code shown to the young person to recognize the same request without exposing their identity."
              )}
            </p>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={isAdult}
                onCheckedChange={(checked) => setIsAdult(checked === true)}
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium">
                  {t("I attest that I am an adult.")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(
                    "A verified account email is also required by the server."
                  )}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={hasAuthority}
                onCheckedChange={(checked) => setHasAuthority(checked === true)}
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium">
                  {t(
                    "I attest that I have parental authority for the young person concerned."
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("Do not approve if this statement is not true.")}
                </span>
              </span>
            </label>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("Social sharing policy version")}: {preview.policyVersion}.{" "}
            <Link href="/legal/social-sharing">
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
        </CardContent>
      </Card>

      <PrivacyBoundaryNotice />
    </div>
  )
}
