"use client"

import Link from "next/link"
import { useLayoutEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ShieldXIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { GuardianConsentClient } from "../[token]/guardian-consent-client"
import { PageMeta } from "@/components/shell/page-chrome"
import { SocialFlow, SocialOutcome } from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
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
        <Spinner className="text-muted-foreground" />
      </div>
    )
  }

  if (!token || !preview.data || preview.isError) {
    return (
      <SocialFlow className="py-6">
        <PageMeta title={t("Guardian consent")} />
        <SocialOutcome
          icon={ShieldXIcon}
          title={t("This request cannot be opened")}
          action={
            <Button variant="outline" render={<Link href="/" />}>
              {t("Return to Avermate")}
            </Button>
          }
        >
          {t(
            "It is invalid, expired, already handled, or linked to another verified account. No social permission was changed."
          )}
        </SocialOutcome>
      </SocialFlow>
    )
  }

  return <GuardianConsentClient token={token} preview={preview.data} />
}
