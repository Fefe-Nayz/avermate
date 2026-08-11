"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  FlagIcon,
  PowerIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  SocialCallout,
  SocialSection,
  SocialStat,
} from "@/components/social/social-ui"
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
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { orpc } from "@/lib/orpc"

function total(values: Record<string, number>) {
  return Object.values(values).reduce((sum, value) => sum + value, 0)
}

/**
 * The social kill switch, and what it currently governs.
 *
 * The state of the flag is the first thing an administrator needs and the
 * hardest to misread wrongly, so it is stated as a sentence with a matching
 * tone rather than as a badge whose two variants looked nearly identical. The
 * counts underneath are operational only — no figure here is derived from
 * anybody's marks.
 */
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

  const enabled = feature.data?.enabled ?? false

  return (
    <>
      <PageMeta title={t("Social moderation")} backHref="/admin" />
      <div className="flex flex-col gap-4">
        <div className="hidden md:block">
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <ShieldCheckIcon className="size-5 text-muted-foreground" />
            {t("Social privacy & moderation")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Operational counts and safety controls. Nothing on these pages exposes a grade or overrides a member's consent."
            )}
          </p>
        </div>

        <SocialSection
          icon={PowerIcon}
          title={t("Social rollout")}
          description={t(
            "Off by default until an administrator deliberately turns it on."
          )}
          footer={
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant={enabled ? "destructive" : "default"}
                    disabled={
                      !feature.data ||
                      reason.trim().length < 10 ||
                      toggle.isPending
                    }
                  />
                }
              >
                {enabled
                  ? t("Disable social access")
                  : t("Enable social access")}
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {enabled
                      ? t("Disable social access now?")
                      : t("Enable social access now?")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {enabled
                      ? t(
                          "Users lose social access immediately; aggregate caches are cleared."
                        )
                      : t(
                          "Eligible users can begin the optional friend and group consent flows. It enables no sharing by itself."
                        )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    variant={enabled ? "destructive" : "default"}
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
          }
        >
          <SocialCallout
            tone={enabled ? "caution" : "positive"}
            title={enabled ? t("Social access is live") : t("Failing closed")}
          >
            {enabled
              ? t(
                  "Disabling hides social access immediately and clears aggregate caches. Safety and audit records survive for their retention period."
                )
              : t(
                  "While the flag is off or unknown, social navigation and routes are inaccessible. School tracking is unaffected."
                )}
          </SocialCallout>

          <div className="space-y-2">
            <Label htmlFor="social-flag-reason">{t("Operational reason")}</Label>
            <Textarea
              id="social-flag-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={10}
              maxLength={500}
              rows={3}
              placeholder={t("Required for the audit trail")}
            />
            <p className="text-xs text-muted-foreground">
              {t("At least 10 characters. It is written to the audit trail.")}
            </p>
          </div>
        </SocialSection>

        {overview.data ? (
          <div className="grid grid-cols-2 gap-3 @2xl/main:grid-cols-3 @4xl/main:grid-cols-5">
            <SocialStat
              icon={UserRoundIcon}
              label={t("Social profiles")}
              value={total(overview.data.profiles)}
            />
            <SocialStat
              icon={UsersRoundIcon}
              label={t("Groups")}
              value={total(overview.data.groups)}
            />
            <SocialStat
              icon={UsersRoundIcon}
              label={t("Memberships")}
              value={total(overview.data.memberships)}
            />
            <SocialStat
              icon={FlagIcon}
              label={t("Safety reports")}
              value={total(overview.data.reports)}
            />
            <SocialStat
              icon={ScrollTextIcon}
              label={t("Consent records")}
              value={total(overview.data.ageBands)}
            />
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
