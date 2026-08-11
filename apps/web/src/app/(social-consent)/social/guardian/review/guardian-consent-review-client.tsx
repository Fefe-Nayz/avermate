"use client"

import Link from "next/link"
import { useLayoutEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ShieldXIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { GuardianConsentClient } from "../[token]/guardian-consent-client"
import { PageMeta } from "@/components/shell/page-chrome"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"
import {
  GUARDIAN_CONSENT_HANDOFF_KEY,
  parseGuardianConsentHandoff,
} from "@/lib/social-invitation"

export function GuardianConsentReviewClient() {
  const t = useExtracted()
  const [token, setToken] = useState<string | null | undefined>(undefined)

  useLayoutEffect(() => {
    const stored = sessionStorage.getItem(GUARDIAN_CONSENT_HANDOFF_KEY)
    sessionStorage.removeItem(GUARDIAN_CONSENT_HANDOFF_KEY)
    queueMicrotask(() => setToken(parseGuardianConsentHandoff(stored)))
  }, [])

  const preview = useQuery({
    ...orpc.social.guardian.preview.queryOptions({
      input: { token: token ?? "" },
    }),
    enabled: Boolean(token),
    retry: false,
  })

  if (token === undefined || (token && preview.isPending)) {
    return (
      <div
        className="grid min-h-64 place-items-center"
        aria-label={t("Loading request")}
      >
        <Spinner />
      </div>
    )
  }

  if (!token || !preview.data || preview.isError) {
    return (
      <>
        <PageMeta title={t("Guardian consent")} />
        <Card className="mx-auto max-w-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldXIcon aria-hidden />
              {t("Guardian request unavailable")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              {t(
                "This request is invalid, expired, already handled or linked to another verified account. No social permission was changed."
              )}
            </p>
            <Button variant="outline" render={<Link href="/" />}>
              {t("Return to Avermate")}
            </Button>
          </CardContent>
        </Card>
      </>
    )
  }

  return <GuardianConsentClient token={token} preview={preview.data} />
}
