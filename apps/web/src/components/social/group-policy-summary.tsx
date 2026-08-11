import Link from "next/link"
import {
  CalendarRangeIcon,
  EyeIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  TargetIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { isSocialMetric, type SocialExposure } from "@/lib/social-presentation"

export interface GroupPolicyView {
  version: number
  purpose: string
  audienceDescription: string
  window: "current_academic_year" | "last_90_days" | "last_30_days"
  rankingsEnabled: boolean
  fields: Array<{
    fieldKey: string
    required: boolean
    exposure: SocialExposure
  }>
}

function usePolicyCopy() {
  const t = useExtracted()
  return {
    metric(value: string) {
      if (!isSocialMetric(value)) return t("Unknown metric")
      switch (value) {
        case "normalizedAverage":
          return t("Normalized average")
        case "median":
          return t("Median result")
        case "trendBand":
          return t("Trend range")
        case "passRateBand":
          return t("Success-rate range")
        case "gradeCountBand":
          return t("Activity range")
        case "genericGoalProgress":
          return t("Goal progress range")
      }
    },
    exposure(value: SocialExposure) {
      switch (value) {
        case "aggregate_only":
          return t("Group aggregate only")
        case "member_visible":
          return t("Visible to participating members")
        case "ranking":
          return t("Eligible for an optional ranking")
      }
    },
  }
}

function PolicyWindow({ value }: { value: GroupPolicyView["window"] }) {
  const t = useExtracted()
  if (value === "current_academic_year") return t("Current academic year")
  if (value === "last_90_days") return t("Last 90 days")
  return t("Last 30 days")
}

export function GroupPolicySummary({
  policy,
  reconsentRequired = false,
}: {
  policy: GroupPolicyView
  reconsentRequired?: boolean
}) {
  const t = useExtracted()
  const copy = usePolicyCopy()

  return (
    <div className="space-y-3">
      {reconsentRequired ? (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <ShieldAlertIcon aria-hidden />
          <AlertTitle>{t("Review the updated sharing policy")}</AlertTitle>
          <AlertDescription>
            {t(
              "Member details, statistics and rankings stay hidden until you make a new choice. Your previous consent never expands automatically."
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="gap-3 py-4">
        <CardHeader className="flex-row items-start justify-between px-4">
          <div>
            <CardTitle className="text-sm">{t("Sharing policy")}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Version {version}", { version: String(policy.version) })}
            </p>
          </div>
          <Badge variant="outline">
            <RotateCcwIcon aria-hidden /> {t("Withdrawal available")}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4 px-4">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-muted/60 p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <TargetIcon className="size-3.5" aria-hidden /> {t("Purpose")}
              </dt>
              <dd className="mt-1 text-sm font-medium">{policy.purpose}</dd>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <UsersRoundIcon className="size-3.5" aria-hidden />{" "}
                {t("Audience")}
              </dt>
              <dd className="mt-1 text-sm font-medium">
                {policy.audienceDescription}
              </dd>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarRangeIcon className="size-3.5" aria-hidden />{" "}
                {t("Data window")}
              </dt>
              <dd className="mt-1 text-sm font-medium">
                <PolicyWindow value={policy.window} />
              </dd>
            </div>
          </dl>

          <div>
            <h3 className="text-sm font-medium">
              {t("Requested information")}
            </h3>
            <ul className="mt-2 divide-y rounded-lg border">
              {policy.fields.map((field) => (
                <li
                  key={field.fieldKey}
                  className="flex flex-wrap items-center gap-2 px-3 py-2.5"
                >
                  <EyeIcon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    {copy.metric(field.fieldKey)}
                  </span>
                  <Badge variant={field.required ? "secondary" : "outline"}>
                    {field.required ? t("Required to join") : t("Optional")}
                  </Badge>
                  <Badge variant="outline">
                    {copy.exposure(field.exposure)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {policy.rankingsEnabled
              ? t(
                  "The group permits rankings, but each eligible metric remains off for you until you opt in separately."
                )
              : t("This policy does not permit named rankings.")}{" "}
            <Link
              href="/legal/social-sharing"
              className="underline underline-offset-3"
            >
              {t("Learn about withdrawal and privacy thresholds")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
