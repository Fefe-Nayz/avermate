"use client"

import Link from "next/link"
import {
  CalendarRangeIcon,
  ScrollTextIcon,
  TargetIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import {
  ExposureBadge,
  SocialCallout,
  SocialSection,
  useSocialLabels,
  type PolicyWindow,
} from "@/components/social/social-ui"
import { Badge } from "@/components/ui/badge"
import type { SocialExposure } from "@/lib/social-presentation"

export interface GroupPolicyView {
  version: number
  purpose: string
  audienceDescription: string
  window: PolicyWindow
  rankingsEnabled: boolean
  fields: Array<{
    fieldKey: string
    required: boolean
    exposure: SocialExposure
  }>
}

/**
 * The agreement itself.
 *
 * This is the document a member is consenting to, so it reads top to bottom as
 * one statement — why, for whom, over what window, and then exactly which
 * derived figures leave the account and how far each one travels.
 */
export function GroupPolicySummary({
  policy,
  reconsentRequired = false,
}: {
  policy: GroupPolicyView
  reconsentRequired?: boolean
}) {
  const t = useExtracted()
  const labels = useSocialLabels()

  const facts = [
    { icon: TargetIcon, label: t("Purpose"), value: policy.purpose },
    {
      icon: UsersRoundIcon,
      label: t("Audience"),
      value: policy.audienceDescription,
    },
    {
      icon: CalendarRangeIcon,
      label: t("Data window"),
      value: labels.window(policy.window),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      {reconsentRequired ? (
        <SocialCallout
          tone="caution"
          title={t("Review the updated sharing policy")}
        >
          {t(
            "Member details, statistics and rankings stay hidden until you make a new choice. Your previous consent never expands automatically."
          )}
        </SocialCallout>
      ) : null}

      <SocialSection
        icon={ScrollTextIcon}
        title={t("Sharing policy")}
        description={t("Version {version}", {
          version: String(policy.version),
        })}
      >
        <dl className="grid gap-3 @lg/main:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="rounded-lg bg-muted/50 p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <fact.icon className="size-3.5 shrink-0" aria-hidden />
                {fact.label}
              </dt>
              <dd className="mt-1 text-sm leading-relaxed font-medium">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>

        <div>
          <h3 className="text-sm font-medium">{t("What leaves your account")}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {t(
              "Derived summaries only. Individual marks, subject names, comments and dates are never group fields."
            )}
          </p>
          <ul className="mt-2 divide-y rounded-lg border">
            {policy.fields.map((field) => (
              <li
                key={field.fieldKey}
                className="flex flex-wrap items-center gap-2 px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 text-sm">
                  {labels.metric(field.fieldKey)}
                </span>
                {field.required ? (
                  <Badge variant="secondary">{t("Required to join")}</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    {t("Optional")}
                  </Badge>
                )}
                <ExposureBadge exposure={field.exposure} />
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {policy.rankingsEnabled
            ? t(
                "This group permits rankings, but every eligible metric stays off for you until you opt in separately."
              )
            : t("This policy does not permit named rankings.")}{" "}
          <Link
            href="/legal/social-sharing"
            className="underline underline-offset-3"
          >
            {t("Withdrawal and privacy thresholds")}
          </Link>
        </p>
      </SocialSection>
    </div>
  )
}
