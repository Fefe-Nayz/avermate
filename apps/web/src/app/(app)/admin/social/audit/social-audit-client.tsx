"use client"

import Link from "next/link"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FileClockIcon, LockKeyholeIcon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { PageMeta } from "@/components/shell/page-chrome"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { SelectControl } from "@/components/forms/controls"
import { INITIAL_ADMIN_SOCIAL_AUDIT_INPUT } from "@/lib/admin-social-inputs"
import { orpc } from "@/lib/orpc"

type AuditFilters = {
  action: string
  entityType: string
  limit: number
  offset: number
}

const SAFE_CHANGED_KEYS = new Set([
  "ageBand",
  "assuranceLevel",
  "assignedToUserId",
  "consents",
  "discovery",
  "enabled",
  "expiresAt",
  "guardianAttestation",
  "invitations",
  "policyVersion",
  "priority",
  "reason",
  "status",
  "state",
])

function actionLabel(action: string, t: ReturnType<typeof useExtracted>) {
  if (action === "feature.enabled") return t("Feature enabled")
  if (action === "feature.disabled") return t("Feature disabled")
  if (action === "group.frozen") return t("Group frozen")
  if (action === "group.unfrozen") return t("Group unfrozen")
  if (action === "profile.frozen") return t("Profile frozen")
  if (action === "profile.unfrozen") return t("Profile unfrozen")
  if (action === "report.moderated") return t("Report moderated")
  if (action === "eligibility.reviewed") return t("Eligibility reviewed")
  if (action === "guardian.provider_verified")
    return t("Guardian assurance verified")
  if (action === "guardian.consent_granted")
    return t("Guardian consent granted")
  if (action === "guardian.consent_revoked")
    return t("Guardian consent revoked")
  return action.replaceAll(".", " · ").replaceAll("_", " ")
}

function entityLabel(entityType: string, t: ReturnType<typeof useExtracted>) {
  if (entityType === "social_feature_flag") return t("Social feature flag")
  if (entityType === "social_group") return t("Social group")
  if (entityType === "social_profile") return t("Social profile")
  if (entityType === "social_report") return t("Social report")
  if (entityType === "social_eligibility") return t("Social eligibility")
  if (entityType === "guardian_consent_request") return t("Guardian request")
  return entityType.replaceAll("_", " ")
}

function changedKeyLabel(key: string, t: ReturnType<typeof useExtracted>) {
  if (key === "ageBand") return t("Age band")
  if (key === "assuranceLevel") return t("Assurance level")
  if (key === "assignedToUserId") return t("Assignee")
  if (key === "consents") return t("Consents")
  if (key === "discovery") return t("Discovery")
  if (key === "enabled") return t("Enabled state")
  if (key === "expiresAt") return t("Expiry")
  if (key === "guardianAttestation") return t("Guardian attestation")
  if (key === "invitations") return t("Invitations")
  if (key === "policyVersion") return t("Policy version")
  if (key === "priority") return t("Priority")
  if (key === "reason") return t("Reason recorded")
  if (key === "status") return t("Status")
  return t("State")
}

export function AdminSocialAuditClient() {
  const t = useExtracted()
  const format = useFormatter()
  const [filters, setFilters] = useState<AuditFilters>({
    ...INITIAL_ADMIN_SOCIAL_AUDIT_INPUT,
  })
  const audit = useQuery(
    orpc.admin.socialAudit.queryOptions({ input: filters })
  )

  function updateFilters(patch: Partial<AuditFilters>) {
    setFilters((current) => ({
      ...current,
      ...patch,
      offset: patch.offset ?? 0,
    }))
  }

  const hasNext = Boolean(
    audit.data && audit.data.offset + audit.data.limit < audit.data.total
  )

  return (
    <>
      <PageMeta title={t("Social audit trail")} backHref="/admin/social" />
      <div className="flex flex-col gap-4">
        <div className="hidden md:block">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Protected social audit trail")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "A chronological record of consent and moderation changes, without grades, raw reasons or invitation secrets."
            )}
          </p>
        </div>

        <Alert>
          <LockKeyholeIcon aria-hidden />
          <AlertTitle>{t("Metadata only")}</AlertTitle>
          <AlertDescription>
            {t(
              "Operational reasons are stored as one-way evidence digests. This screen shows only the categories of fields changed."
            )}
          </AlertDescription>
        </Alert>

        <Card className="py-4">
          <CardContent className="grid gap-2 px-4 sm:grid-cols-2">
            <SelectControl
              aria-label={t("Audit action filter")}
              value={filters.action}
              onValueChange={(value) =>
                updateFilters({ action: value })
              }
              placeholder={t("All actions")}
              options={[
                { value: "feature.enabled", label: t("Feature enabled") },
                { value: "feature.disabled", label: t("Feature disabled") },
                { value: "group.frozen", label: t("Group frozen") },
                { value: "group.unfrozen", label: t("Group unfrozen") },
                { value: "profile.frozen", label: t("Profile frozen") },
                { value: "report.moderated", label: t("Report moderated") },
                { value: "eligibility.reviewed", label: t("Eligibility reviewed") },
                { value: "guardian.provider_verified", label: t("Guardian assurance verified") },
              ]}
            />
            <SelectControl
              aria-label={t("Audit entity filter")}
              value={filters.entityType}
              onValueChange={(value) =>
                updateFilters({ entityType: value })
              }
              placeholder={t("All entity types")}
              options={[
                { value: "social_feature_flag", label: t("Social feature flag") },
                { value: "social_group", label: t("Social group") },
                { value: "social_profile", label: t("Social profile") },
                { value: "social_report", label: t("Social report") },
                { value: "social_eligibility", label: t("Social eligibility") },
                { value: "guardian_consent_request", label: t("Guardian request") },
              ]}
            />
          </CardContent>
        </Card>

        <Card className="overflow-hidden py-0">
          <ol className="divide-y">
            {audit.data?.items.map((event) => {
              const safeKeys = event.changedKeys.filter((key) =>
                SAFE_CHANGED_KEYS.has(key)
              )
              return (
                <li key={event.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
                      <FileClockIcon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium">
                        {actionLabel(event.action, t)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entityLabel(event.entityType, t)} ·{" "}
                        {format.dateTime(event.occurredAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {safeKeys.length ? (
                      safeKeys.map((key) => (
                        <Badge key={key} variant="outline">
                          {changedKeyLabel(key, t)}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="outline">
                        {t("Protected fields changed")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {event.actorUserId ? (
                      <Link
                        href={`/admin/users/${event.actorUserId}`}
                        className="text-muted-foreground underline-offset-3 hover:underline"
                      >
                        {t("View actor account")}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("System actor")}
                      </span>
                    )}
                    {event.subjectUserId ? (
                      <Link
                        href={`/admin/users/${event.subjectUserId}`}
                        className="text-muted-foreground underline-offset-3 hover:underline"
                      >
                        {t("View affected account")}
                      </Link>
                    ) : null}
                  </div>
                </li>
              )
            })}
            {audit.data?.items.length === 0 ? (
              <li className="p-10 text-center text-sm text-muted-foreground">
                {t("No audit event matches these filters.")}
              </li>
            ) : null}
          </ol>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {audit.data
              ? t("{count} audit events", { count: String(audit.data.total) })
              : t("Loading audit events…")}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={filters.offset === 0 || audit.isFetching}
              onClick={() =>
                updateFilters({
                  offset: Math.max(0, filters.offset - filters.limit),
                })
              }
            >
              {t("Previous")}
            </Button>
            <Button
              variant="outline"
              disabled={!hasNext || audit.isFetching}
              onClick={() =>
                updateFilters({ offset: filters.offset + filters.limit })
              }
            >
              {t("Next")}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
