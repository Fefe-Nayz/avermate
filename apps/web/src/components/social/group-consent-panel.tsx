"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ShieldCheckIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import {
  GroupPolicySummary,
  type GroupPolicyView,
} from "@/components/social/group-policy-summary"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { SelectControl } from "@/components/forms/controls"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"
import type { SocialMetric } from "@/components/social/group-policy-editor"

export function GroupConsentPanel({
  groupId,
  policy,
}: {
  groupId: string
  policy: GroupPolicyView & { digest: string }
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const years = useQuery(orpc.years.list.queryOptions())
  const [selected, setSelected] = useState<SocialMetric[]>(
    policy.fields
      .filter((field) => field.required)
      .map((field) => field.fieldKey as SocialMetric)
  )
  const [yearId, setYearId] = useState("")
  const [accepted, setAccepted] = useState(false)

  const reconsent = useMutation({
    ...orpc.social.groups.policy.reconsent.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.get.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.policy.current.key(),
        }),
      ])
    },
  })

  function toggle(metric: SocialMetric, checked: boolean) {
    setSelected((current) =>
      checked
        ? current.includes(metric)
          ? current
          : [...current, metric]
        : current.filter((candidate) => candidate !== metric)
    )
  }

  const activeYears = (years.data ?? []).filter((year) => !year.archivedAt)
  const required = new Set(
    policy.fields
      .filter((field) => field.required)
      .map((field) => field.fieldKey)
  )

  return (
    <div className="space-y-4">
      <GroupPolicySummary policy={policy} reconsentRequired />

      <Card>
        <CardHeader>
          <CardTitle>{t("Your field choices")}</CardTitle>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(
              "Required fields are necessary for this group's stated purpose. Optional fields stay off unless you select them. You can refuse by leaving the group or withdraw later."
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y rounded-xl border">
            {policy.fields.map((field) => {
              const metric = field.fieldKey as SocialMetric
              const isRequired = required.has(field.fieldKey)
              return (
                <li key={field.fieldKey} className="p-3">
                  <label className="flex items-start gap-3">
                    <Checkbox
                      checked={isRequired || selected.includes(metric)}
                      disabled={isRequired || reconsent.isPending}
                      onCheckedChange={(checked) =>
                        toggle(metric, checked === true)
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium">
                        {metric === "normalizedAverage"
                          ? t("Normalized average")
                          : metric === "median"
                            ? t("Median result")
                            : metric === "trendBand"
                              ? t("Trend range")
                              : metric === "passRateBand"
                                ? t("Success-rate range")
                                : metric === "gradeCountBand"
                                  ? t("Activity range")
                                  : t("Goal progress range")}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {isRequired ? t("Required to join") : t("Optional")}
                        {" · "}
                        {field.exposure === "aggregate_only"
                          ? t("Group aggregate only")
                          : field.exposure === "member_visible"
                            ? t("Visible to participating members")
                            : t("Eligible for separate ranking opt-in")}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>

          <div className="space-y-2">
            <label htmlFor="consent-year" className="text-sm font-medium">
              {t("Academic year used to derive these summaries")}
            </label>
            <SelectControl
              id="consent-year"
              value={yearId}
              disabled={reconsent.isPending}
              onValueChange={setYearId}
              placeholder={t("Choose an academic year…")}
              options={activeYears.map((year) => ({
                value: year.id,
                label: year.name,
              }))}
            />
          </div>

          <Alert>
            <ShieldCheckIcon aria-hidden />
            <AlertTitle>{t("No academic snapshot is copied")}</AlertTitle>
            <AlertDescription>
              {t(
                "The server derives only the selected summaries for this policy and window. Group owners and moderators cannot bypass your choices."
              )}
            </AlertDescription>
          </Alert>

          <label className="flex items-start gap-3 rounded-xl border p-4">
            <Checkbox
              checked={accepted}
              disabled={reconsent.isPending}
              onCheckedChange={(checked) => setAccepted(checked === true)}
            />
            <span className="text-sm leading-relaxed">
              {t(
                "I accept this exact policy version and the selected fields. I understand how to withdraw, and that ranking participation stays off until a separate choice."
              )}
            </span>
          </label>

          {reconsent.error ? (
            <p role="alert" className="text-sm text-destructive">
              {t(
                "The policy changed or consent could not be saved. Review it again."
              )}
            </p>
          ) : null}

          <Button
            disabled={!accepted || !yearId || reconsent.isPending}
            onClick={() =>
              reconsent.mutate({
                groupId,
                policyDigest: policy.digest,
                selectedFields: selected,
                sharedYearId: yearId,
                accepted: true,
                channel: "web",
              })
            }
          >
            {reconsent.isPending ? <Spinner /> : null}
            {t("Accept selected sharing")}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
