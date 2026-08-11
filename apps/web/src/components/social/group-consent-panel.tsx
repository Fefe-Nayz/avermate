"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarRangeIcon, SlidersHorizontalIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import {
  GroupPolicySummary,
  type GroupPolicyView,
} from "@/components/social/group-policy-summary"
import {
  MetricChoice,
  SocialCallout,
  SocialSection,
  useSocialLabels,
} from "@/components/social/social-ui"
import { ConsentCheck } from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SelectControl } from "@/components/forms/controls"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"
import type { SocialMetric } from "@/lib/social-presentation"

/**
 * Agreeing to a policy.
 *
 * The reader has to answer three things — which optional figures they are
 * willing to contribute, from which year, and whether they accept — so those
 * are the three blocks, in that order, under the policy they are answering.
 */
export function GroupConsentPanel({
  groupId,
  policy,
}: {
  groupId: string
  policy: GroupPolicyView & { digest: string }
}) {
  const t = useExtracted()
  const labels = useSocialLabels()
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
  const optionalCount = policy.fields.length - required.size
  const chosenOptional = selected.filter(
    (metric) => !required.has(metric)
  ).length

  return (
    <div className="flex flex-col gap-4">
      <GroupPolicySummary policy={policy} reconsentRequired />

      <SocialSection
        icon={SlidersHorizontalIcon}
        title={t("What you contribute")}
        description={
          optionalCount
            ? t("{chosen} of {total} optional figures selected.", {
                chosen: String(chosenOptional),
                total: String(optionalCount),
              })
            : t("This policy asks only for required figures.")
        }
        bodyClassName="p-0"
      >
        <ul className="divide-y">
          {policy.fields.map((field) => {
            const metric = field.fieldKey as SocialMetric
            const isRequired = required.has(field.fieldKey)
            return (
              <li key={field.fieldKey}>
                <MetricChoice
                  label={labels.metric(field.fieldKey)}
                  description={labels.exposureDescription(field.exposure)}
                  exposure={field.exposure}
                  required={isRequired}
                  checked={isRequired || selected.includes(metric)}
                  disabled={isRequired || reconsent.isPending}
                  onCheckedChange={(checked) => toggle(metric, checked)}
                />
              </li>
            )
          })}
        </ul>
      </SocialSection>

      <SocialSection
        icon={CalendarRangeIcon}
        title={t("Which year these figures come from")}
        description={t(
          "Only this year is read, and only through the policy's window."
        )}
      >
        <div className="space-y-2">
          <Label htmlFor="consent-year" className="sr-only">
            {t("Academic year")}
          </Label>
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

        <SocialCallout tone="positive" title={t("No snapshot is copied")}>
          {t(
            "The server derives the selected summaries on demand. Owners and moderators cannot bypass your choices, and withdrawing stops the derivation."
          )}
        </SocialCallout>
      </SocialSection>

      <ConsentCheck
        checked={accepted}
        disabled={reconsent.isPending}
        onCheckedChange={setAccepted}
      >
        {t(
          "I accept this exact policy version and the figures selected above. I understand how to withdraw, and that ranking participation stays off until a separate choice."
        )}
      </ConsentCheck>

      {reconsent.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(
            "The policy changed or consent could not be saved. Review it again."
          )}
        </p>
      ) : null}

      <div className="flex justify-end">
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
          {t("Accept and start sharing")}
        </Button>
      </div>
    </div>
  )
}
