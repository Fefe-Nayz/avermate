"use client"

import { useExtracted } from "next-intl"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SelectControl } from "@/components/forms/controls"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

export type SocialMetric =
  | "normalizedAverage"
  | "median"
  | "trendBand"
  | "passRateBand"
  | "gradeCountBand"
  | "genericGoalProgress"
export type MetricExposure = "aggregate_only" | "member_visible" | "ranking"

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

const METRICS: SocialMetric[] = [
  "normalizedAverage",
  "median",
  "trendBand",
  "passRateBand",
  "gradeCountBand",
  "genericGoalProgress",
]

function canRank(metric: SocialMetric) {
  return (
    metric === "normalizedAverage" ||
    metric === "median" ||
    metric === "genericGoalProgress"
  )
}

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

  function metricLabel(metric: SocialMetric) {
    if (metric === "normalizedAverage") return t("Normalized average")
    if (metric === "median") return t("Median result")
    if (metric === "trendBand") return t("Trend range")
    if (metric === "passRateBand") return t("Success-rate range")
    if (metric === "gradeCountBand") return t("Activity range")
    return t("Goal progress range")
  }

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
    <div className="space-y-5">
      <div className="space-y-2">
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
          placeholder={t(
            "For example: accepted members of this private study group"
          )}
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

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          {t("Requested comparisons")}
        </legend>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "Only derived summaries are requested. Raw notes, subjects, comments and individual dates are never group fields. Aggregate-only is the safest default."
          )}
        </p>
        <ul className="divide-y rounded-xl border">
          {METRICS.map((metric) => {
            const field = value.fields.find(
              (candidate) => candidate.fieldKey === metric
            )
            return (
              <li key={metric} className="space-y-3 p-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <Checkbox
                    checked={Boolean(field)}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      toggleMetric(metric, checked === true)
                    }
                  />
                  <span className="text-sm font-medium">
                    {metricLabel(metric)}
                  </span>
                </label>
                {field ? (
                  <div className="grid gap-3 pl-7 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <SelectControl
                      aria-label={t("Exposure for {metric}", {
                        metric: metricLabel(metric),
                      })}
                      value={field.exposure}
                      disabled={disabled}
                      onValueChange={(next) =>
                        updateMetric(metric, {
                          exposure: next as MetricExposure,
                        })
                      }
                      options={[
                        {
                          value: "aggregate_only",
                          label: t("Group aggregate only"),
                        },
                        {
                          value: "member_visible",
                          label: t("Visible per participating member"),
                        },
                        ...(canRank(metric) && value.rankingsEnabled
                          ? [
                              {
                                value: "ranking",
                                label: t("Optional named ranking"),
                              },
                            ]
                          : []),
                      ]}
                    />
                    <label className="flex items-center gap-2 text-sm">
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
      </fieldset>

      <label className="flex items-start justify-between gap-4 rounded-xl border p-4">
        <span>
          <span className="block text-sm font-medium">
            {t("Allow optional rankings")}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {t(
              "OFF by default. Every eligible member must separately share the metric and opt in. Privacy thresholds still apply."
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
