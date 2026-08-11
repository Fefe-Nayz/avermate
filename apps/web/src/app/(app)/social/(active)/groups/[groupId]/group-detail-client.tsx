"use client"

import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ShieldCheckIcon, UsersRoundIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { GroupConsentPanel } from "@/components/social/group-consent-panel"
import { GroupManagementPanel } from "@/components/social/group-management-panel"
import { GroupMembersPanel } from "@/components/social/group-members-panel"
import { GroupPolicySummary } from "@/components/social/group-policy-summary"
import { GroupStatsPanel } from "@/components/social/group-stats-panel"
import {
  PrivacyBoundaryNotice,
  SocialPageHeading,
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import type { SocialMetric } from "@/components/social/group-policy-editor"
import { orpc } from "@/lib/orpc"

export function GroupDetailClient({ groupId }: { groupId: string }) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const detail = useQuery(
    orpc.social.groups.get.queryOptions({ input: { groupId } })
  )
  const current = useQuery(
    orpc.social.groups.policy.current.queryOptions({ input: { groupId } })
  )
  const withdraw = useMutation({
    ...orpc.social.groups.policy.withdraw.mutationOptions(),
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
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.stats.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.rankings.key(),
        }),
      ])
    },
  })

  if (!detail.data || !current.data) {
    return (
      <div className="grid min-h-64 place-items-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  const group = detail.data.group
  const policy = current.data.policy
  const consentRequired = current.data.membershipState !== "active"

  return (
    <div className="flex flex-col gap-4">
      <SocialPageHeading
        title={group.name}
        description={group.description || t("Private consent-based group")}
        action={
          <Button variant="outline" render={<Link href="/social/groups" />}>
            {t("All groups")}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">
          <UsersRoundIcon />
          {group.type === "class"
            ? t("Self-declared class group")
            : group.type === "study_group"
              ? t("Study group")
              : t("Friends group")}
        </Badge>
        <Badge variant="outline">
          {group.role === "owner"
            ? t("Owner")
            : group.role === "moderator"
              ? t("Moderator")
              : t("Member")}
        </Badge>
        {consentRequired ? (
          <Badge variant="secondary">
            {t("Sharing paused — review required")}
          </Badge>
        ) : (
          <Badge variant="outline">
            <ShieldCheckIcon /> {t("Current policy accepted")}
          </Badge>
        )}
      </div>

      {consentRequired ? (
        <GroupConsentPanel groupId={groupId} policy={policy} />
      ) : (
        <>
          <GroupPolicySummary policy={policy} />

          <Card className="border-primary/20 py-4">
            <CardContent className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">
                  {t("Your sharing is active")}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t(
                    "Withdrawal is immediate: your year link is cleared, ranking opt-ins turn off, and aggregates are recalculated."
                  )}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="outline" disabled={withdraw.isPending} />
                  }
                >
                  {t("Withdraw sharing")}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("Withdraw from this policy?")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t(
                        "Your membership remains pending so you can review again later, but member details, statistics and rankings become unavailable now."
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => withdraw.mutate({ groupId })}
                    >
                      {t("Withdraw now")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          <GroupMembersPanel
            groupId={groupId}
            groupRevision={group.revision}
            viewerMembershipId={group.membershipId}
            viewerRole={group.role}
            members={detail.data.members}
          />

          <GroupStatsPanel
            groupId={groupId}
            fields={policy.fields}
            rankingsEnabled={policy.rankingsEnabled}
            viewerRankingOptIns={
              current.data.viewerRankingOptIns as SocialMetric[]
            }
          />

          <GroupManagementPanel group={group} policy={policy} />
        </>
      )}

      <PrivacyBoundaryNotice />
    </div>
  )
}
