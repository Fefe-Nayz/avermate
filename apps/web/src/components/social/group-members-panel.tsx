"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ShieldBanIcon, UserMinusIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { ReportDialog } from "@/components/social/report-dialog"
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
import { SelectControl } from "@/components/forms/controls"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

interface MemberView {
  membershipId: string
  alias: string
  role: "owner" | "moderator" | "member"
  state: "active" | "consent_required" | "left" | "removed"
  metrics: Record<
    string,
    { metric: string; numeric: number | null; band: string | null }
  >
}

export function GroupMembersPanel({
  groupId,
  groupRevision,
  viewerMembershipId,
  viewerRole,
  members,
}: {
  groupId: string
  groupRevision: number
  viewerMembershipId: string
  viewerRole: "owner" | "moderator" | "member"
  members: MemberView[]
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.social.groups.get.key() }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.stats.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.rankings.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.blocks.list.key(),
      }),
    ])
  }
  const setRole = useMutation({
    ...orpc.social.groups.members.setRole.mutationOptions(),
    onSuccess: refresh,
  })
  const remove = useMutation({
    ...orpc.social.groups.members.remove.mutationOptions(),
    onSuccess: refresh,
  })
  const transfer = useMutation({
    ...orpc.social.groups.transfer.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Group ownership transferred."))
      await refresh()
    },
  })
  const block = useMutation({
    ...orpc.social.blocks.create.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(
        t("Account blocked. Shared access was recalculated immediately.")
      )
      await refresh()
    },
  })
  const busy =
    setRole.isPending ||
    remove.isPending ||
    transfer.isPending ||
    block.isPending
  const manager = viewerRole === "owner" || viewerRole === "moderator"

  function roleLabel(role: MemberView["role"]) {
    if (role === "owner") return t("Owner")
    if (role === "moderator") return t("Moderator")
    return t("Member")
  }

  function metricLabel(metric: string) {
    if (metric === "normalizedAverage") return t("Normalized average")
    if (metric === "median") return t("Median result")
    if (metric === "trendBand") return t("Trend range")
    if (metric === "passRateBand") return t("Success-rate range")
    if (metric === "gradeCountBand") return t("Activity range")
    return t("Goal progress range")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Participating members")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t(
            "Only aliases and policy-approved member-visible summaries appear. Owners and moderators receive no bypass."
          )}
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-xl border">
          {members.map((member) => {
            const self = member.membershipId === viewerMembershipId
            return (
              <li key={member.membershipId} className="space-y-3 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {member.alias} {self ? `(${t("You")})` : ""}
                  </span>
                  <Badge variant="outline">{roleLabel(member.role)}</Badge>
                  {member.state === "consent_required" ? (
                    <Badge variant="secondary">{t("Reconsent required")}</Badge>
                  ) : null}
                </div>

                {Object.keys(member.metrics).length ? (
                  <dl className="flex flex-wrap gap-2">
                    {Object.entries(member.metrics).map(
                      ([metric, projection]) => (
                        <div
                          key={metric}
                          className="rounded-lg bg-muted/60 px-3 py-2"
                        >
                          <dt className="text-[11px] text-muted-foreground">
                            {metricLabel(metric)}
                          </dt>
                          <dd className="text-sm font-medium">
                            {projection.numeric !== null
                              ? `${projection.numeric.toFixed(1)}%`
                              : projection.band || t("Protected")}
                          </dd>
                        </div>
                      )
                    )}
                  </dl>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "No member-visible summaries are available for this viewer."
                    )}
                  </p>
                )}

                {!self ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {viewerRole === "owner" && member.role !== "owner" ? (
                      <SelectControl
                        aria-label={t("Member role")}
                        value={member.role}
                        disabled={busy}
                        className="w-36"
                        onValueChange={(value) =>
                          setRole.mutate({
                            groupId,
                            membershipId: member.membershipId,
                            role: value as "member" | "moderator",
                          })
                        }
                        options={[
                          { value: "member", label: t("Member") },
                          { value: "moderator", label: t("Moderator") },
                        ]}
                      />
                    ) : null}

                    {manager && member.role !== "owner" ? (
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button size="sm" variant="ghost" disabled={busy} />
                          }
                        >
                          <UserMinusIcon /> {t("Remove")}
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t("Remove this member?")}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t(
                                "Their membership and access end immediately. Aggregates and rankings are recalculated without their data."
                              )}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() =>
                                remove.mutate({
                                  groupId,
                                  membershipId: member.membershipId,
                                })
                              }
                            >
                              {t("Remove member")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}

                    {viewerRole === "owner" && member.state === "active" ? (
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                            />
                          }
                        >
                          {t("Transfer ownership")}
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t("Transfer group ownership?")}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t(
                                "The new owner can manage policies and members, but still cannot bypass anyone's academic sharing choices."
                              )}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                transfer.mutate({
                                  groupId,
                                  membershipId: member.membershipId,
                                  expectedRevision: groupRevision,
                                })
                              }
                            >
                              {t("Transfer ownership")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}

                    <ReportDialog
                      source="group_membership"
                      sourceId={member.membershipId}
                      compact
                    />
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("Block member")}
                            disabled={busy}
                          />
                        }
                      >
                        <ShieldBanIcon />
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t("Block this member?")}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t(
                              "Their identity and contributions become unavailable to you immediately. This does not give moderators extra information."
                            )}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() =>
                              block.mutate({
                                source: "group_membership",
                                sourceId: member.membershipId,
                              })
                            }
                          >
                            {t("Block account")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
