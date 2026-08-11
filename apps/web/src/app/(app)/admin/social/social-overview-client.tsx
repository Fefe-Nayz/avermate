"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { PageMeta } from "@/components/shell/page-chrome"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { orpc } from "@/lib/orpc"

function total(values: Record<string, number>) {
  return Object.values(values).reduce((sum, value) => sum + value, 0)
}

export function AdminSocialOverviewClient() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const feature = useQuery(orpc.admin.socialFeatureStatus.queryOptions())
  const overview = useQuery(orpc.admin.socialOverview.queryOptions())
  const [reason, setReason] = useState("")
  const toggle = useMutation({
    ...orpc.admin.setSocialFeatureEnabled.mutationOptions(),
    onSuccess: async () => {
      setReason("")
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.admin.socialFeatureStatus.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.eligibility.get.key(),
        }),
      ])
    },
  })

  return (
    <>
      <PageMeta title={t("Social moderation")} backHref="/admin" />
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Social privacy & moderation")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Operational counts and safety controls only. This panel never exposes grades or bypasses member consent."
            )}
          </p>
        </div>

        <Card
          className={feature.data?.enabled ? "border-amber-500/30" : undefined}
        >
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>{t("Social rollout flag")}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(
                  "The feature remains off by default until an administrator deliberately enables it."
                )}
              </p>
            </div>
            <Badge variant={feature.data?.enabled ? "secondary" : "outline"}>
              {feature.data?.enabled ? t("Enabled") : t("Disabled")}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              {feature.data?.enabled ? (
                <ShieldAlertIcon aria-hidden />
              ) : (
                <ShieldCheckIcon aria-hidden />
              )}
              <AlertTitle>
                {feature.data?.enabled
                  ? t("Live social access")
                  : t("Fail-closed rollout")}
              </AlertTitle>
              <AlertDescription>
                {feature.data?.enabled
                  ? t(
                      "Disabling hides social access immediately and clears aggregate caches. Existing safety and audit records remain for their configured retention period."
                    )
                  : t(
                      "When disabled or unknown, navigation and social routes stay inaccessible. School tracking remains available."
                    )}
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="social-flag-reason">
                {t("Operational reason")}
              </Label>
              <Textarea
                id="social-flag-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={10}
                maxLength={500}
                placeholder={t("Required for the audit trail")}
              />
            </div>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant={feature.data?.enabled ? "destructive" : "default"}
                    disabled={
                      !feature.data ||
                      reason.trim().length < 10 ||
                      toggle.isPending
                    }
                  />
                }
              >
                {feature.data?.enabled
                  ? t("Disable social access")
                  : t("Enable social access")}
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {feature.data?.enabled
                      ? t("Disable social access now?")
                      : t("Enable social access now?")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {feature.data?.enabled
                      ? t(
                          "Users lose social access immediately; aggregate caches are cleared."
                        )
                      : t(
                          "Eligible users can begin optional friends and group consent flows. This does not enable any sharing by default."
                        )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    variant={feature.data?.enabled ? "destructive" : "default"}
                    onClick={() =>
                      feature.data &&
                      toggle.mutate({
                        enabled: !feature.data.enabled,
                        expectedRevision: feature.data.revision,
                        reason: reason.trim(),
                      })
                    }
                  >
                    {t("Confirm rollout change")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>

        {overview.data ? (
          <div className="grid grid-cols-2 gap-3 @xl/main:grid-cols-5">
            {[
              [t("Social profiles"), total(overview.data.profiles)],
              [t("Groups"), total(overview.data.groups)],
              [t("Memberships"), total(overview.data.memberships)],
              [t("Safety reports"), total(overview.data.reports)],
              [t("Consent records"), total(overview.data.ageBands)],
            ].map(([label, value]) => (
              <Card key={String(label)} className="py-3">
                <CardContent className="px-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-2xl font-semibold">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          <Link
            href="/legal/social-sharing"
            className="underline underline-offset-3"
          >
            {t("Review the user-facing social sharing summary")}
          </Link>
        </p>
      </div>
    </>
  )
}
