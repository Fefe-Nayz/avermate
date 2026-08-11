"use client"

import { TrophyIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import {
  ExposureChoice,
  SocialCallout,
  useSocialLabels,
} from "@/components/social/social-ui"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SelectControl } from "@/components/forms/controls"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { SOCIAL_METRICS } from "@/lib/social-presentation"
import type {
  SocialExposure,
  SocialMetric as PresentationMetric,
} from "@/lib/social-presentation"

export type SocialMetric = PresentationMetric
export type MetricExposure = SocialExposure

export interface PolicyDraft {
  purpose: string
  audienceDescription: string
  window: "current_academic_year" | "last_90_days" | "last_30_days"
  rankingsEnabled: boolean
  fields: Array<{
    fieldKey: SocialMetric
    required: boolean
    exposure: MetricExposure
  }>
}

export const DEFAULT_POLICY_DRAFT: PolicyDraft = {
  purpose: "",
  audienceDescription: "",
  window: "current_academic_year",
  rankingsEnabled: false,
  fields: [
    {
      fieldKey: "normalizedAverage",
      required: false,
      exposure: "aggregate_only",
    },
  ],
}

function canRank(metric: SocialMetric) {
  return (
    metric === "normalizedAverage" ||
    metric === "median" ||
    metric === "genericGoalProgress"
  )
}

/**
 * Writing the agreement.
 *
 * Each metric is one row that expands into its own settings when included, so
 * the author sees the shape of what they are asking for as a list rather than
 * as a form. Exposure is the consequential choice here and is laid out as the
 * scale it is instead of hidden inside a dropdown.
 */
export function GroupPolicyEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: PolicyDraft
  onChange: (next: PolicyDraft) => void
  disabled?: boolean
}) {
  const t = useExtracted()
  const labels = useSocialLabels()

  function toggleMetric(metric: SocialMetric, included: boolean) {
    onChange({
      ...value,
      fields: included
        ? [
            ...value.fields,
            { fieldKey: metric, required: false, exposure: "aggregate_only" },
          ]
        : value.fields.filter((field) => field.fieldKey !== metric),
    })
  }

  function updateMetric(
    metric: SocialMetric,
    patch: Partial<PolicyDraft["fields"][number]>
  ) {
    onChange({
      ...value,
      fields: value.fields.map((field) =>
        field.fieldKey === metric ? { ...field, ...patch } : field
      ),
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 @lg/main:grid-cols-2">
        <div className="space-y-2 @lg/main:col-span-2">
          <Label htmlFor="group-purpose">{t("Purpose")}</Label>
          <Textarea
            id="group-purpose"
            value={value.purpose}
            onChange={(event) =>
              onChange({ ...value, purpose: event.target.value })
            }
            placeholder={t(
              "Explain why this group needs the requested comparisons."
            )}
            minLength={10}
            maxLength={500}
            rows={3}
            disabled={disabled}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="group-audience">
            {t("Who will see shared results?")}
          </Label>
          <Input
            id="group-audience"
            value={value.audienceDescription}
            onChange={(event) =>
              onChange({ ...value, audienceDescription: event.target.value })
            }
            placeholder={t("Accepted members of this private study group")}
            minLength={3}
            maxLength={240}
            disabled={disabled}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="group-window">{t("Data window")}</Label>
          <SelectControl
            id="group-window"
            value={value.window}
            disabled={disabled}
            onValueChange={(next) =>
              onChange({ ...value, window: next as PolicyDraft["window"] })
            }
            options={[
              {
                value: "current_academic_year",
                label: t("Current academic year"),
              },
              { value: "last_90_days", label: t("Last 90 days") },
              { value: "last_30_days", label: t("Last 30 days") },
            ]}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">
          {t("Requested comparisons")}
        </legend>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "Only derived summaries can be requested. Raw marks, subjects, comments and individual dates are never group fields — aggregate-only is the safest setting."
          )}
        </p>
        <ul className="divide-y rounded-xl border">
          {SOCIAL_METRICS.map((metric) => {
            const field = value.fields.find(
              (candidate) => candidate.fieldKey === metric
            )
            return (
              <li key={metric}>
                <label
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 transition-colors",
                    disabled ? "cursor-default" : "cursor-pointer hover:bg-accent/40"
                  )}
                >
                  <Checkbox
                    checked={Boolean(field)}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      toggleMetric(metric, checked === true)
                    }
                  />
                  <span
                    className={cn(
                      "text-sm",
                      field ? "font-medium" : "text-muted-foreground"
                    )}
                  >
                    {labels.metric(metric)}
                  </span>
                </label>
                {field ? (
                  <div className="flex flex-col gap-2.5 border-t bg-muted/30 px-3 py-3 pl-10">
                    <ExposureChoice
                      value={field.exposure}
                      disabled={disabled}
                      allowRanking={canRank(metric) && value.rankingsEnabled}
                      onValueChange={(exposure) =>
                        updateMetric(metric, { exposure })
                      }
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {labels.exposureDescription(field.exposure)}
                    </p>
                    <label className="flex w-fit cursor-pointer items-center gap-2 text-xs">
                      <Checkbox
                        checked={field.required}
                        disabled={disabled}
                        onCheckedChange={(checked) =>
                          updateMetric(metric, { required: checked === true })
                        }
                      />
                      {t("Required to join")}
                    </label>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
        {value.fields.length === 0 ? (
          <SocialCallout tone="caution" title={t("Choose at least one figure")}>
            {t("A policy that requests nothing cannot be published.")}
          </SocialCallout>
        ) : null}
      </fieldset>

      <label className="flex items-start justify-between gap-4 rounded-xl border p-4">
        <span>
          <span className="flex items-center gap-2 text-sm font-medium">
            <TrophyIcon className="size-4 shrink-0" aria-hidden />
            {t("Allow optional rankings")}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {t(
              "Off by default. Even when allowed, each member must share the metric and then opt in separately. Privacy thresholds still apply."
            )}
          </span>
        </span>
        <Switch
          checked={value.rankingsEnabled}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({
              ...value,
              rankingsEnabled: checked,
              fields: checked
                ? value.fields
                : value.fields.map((field) =>
                    field.exposure === "ranking"
                      ? { ...field, exposure: "aggregate_only" }
                      : field
                  ),
            })
          }
        />
      </label>
    </div>
  )
}
