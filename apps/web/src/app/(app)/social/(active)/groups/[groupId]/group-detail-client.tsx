"use client"

import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  ChartNoAxesColumnIcon,
  ScrollTextIcon,
  Settings2Icon,
  ShieldCheckIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { GroupConsentPanel } from "@/components/social/group-consent-panel"
import { GroupManagementPanel } from "@/components/social/group-management-panel"
import { GroupMembersPanel } from "@/components/social/group-members-panel"
import { GroupPolicySummary } from "@/components/social/group-policy-summary"
import { GroupStatsPanel } from "@/components/social/group-stats-panel"
import {
  GroupTypeBadge,
  PrivacyNote,
  RoleBadge,
  SocialCallout,
  SocialHeading,
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
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SocialMetric } from "@/components/social/group-policy-editor"
import { orpc } from "@/lib/orpc"

/**
 * One group.
 *
 * Four unrelated concerns — the agreement, the roster, the comparisons and the
 * controls — used to sit end to end on one page, so reaching the members list
 * meant scrolling past a policy editor. They are now four destinations, and a
 * group whose policy is pending shows only the decision that unblocks it.
 */
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
      <SocialHeading
        icon={UsersRoundIcon}
        title={group.name}
        description={group.description || undefined}
        action={
          <Button variant="outline" render={<Link href="/social/groups" />}>
            <ArrowLeftIcon /> {t("All groups")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <GroupTypeBadge type={group.type} />
        <RoleBadge role={group.role} />
        {consentRequired ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-caution/12 px-2 py-0.5 text-xs font-medium text-caution">
            {t("Sharing paused")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-positive/10 px-2 py-0.5 text-xs font-medium text-positive">
            <ShieldCheckIcon className="size-3" aria-hidden />
            {t("Policy accepted")}
          </span>
        )}
      </div>

      {consentRequired ? (
        <GroupConsentPanel groupId={groupId} policy={policy} />
      ) : (
        <Tabs defaultValue="policy" className="gap-4">
          <TabsList className="w-full overflow-x-auto @lg/main:w-fit">
            <TabsTrigger value="policy">
              <ScrollTextIcon /> {t("Policy")}
            </TabsTrigger>
            <TabsTrigger value="members">
              <UsersRoundIcon /> {t("Members")}
            </TabsTrigger>
            <TabsTrigger value="stats">
              <ChartNoAxesColumnIcon /> {t("Comparisons")}
            </TabsTrigger>
            <TabsTrigger value="manage">
              <Settings2Icon /> {t("Manage")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="policy" className="flex flex-col gap-4">
            <GroupPolicySummary policy={policy} />
            <SocialCallout
              tone="positive"
              title={t("Your sharing is active")}
              action={
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={withdraw.isPending}
                      />
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
              }
            >
              {t(
                "Withdrawal is immediate: your year link is cleared, ranking opt-ins turn off, and the group's aggregates are recalculated without you."
              )}
            </SocialCallout>
          </TabsContent>

          <TabsContent value="members">
            <GroupMembersPanel
              groupId={groupId}
              groupRevision={group.revision}
              viewerMembershipId={group.membershipId}
              viewerRole={group.role}
              members={detail.data.members}
            />
          </TabsContent>

          <TabsContent value="stats">
            <GroupStatsPanel
              groupId={groupId}
              fields={policy.fields}
              rankingsEnabled={policy.rankingsEnabled}
              viewerRankingOptIns={
                current.data.viewerRankingOptIns as SocialMetric[]
              }
            />
          </TabsContent>

          <TabsContent value="manage">
            <GroupManagementPanel group={group} policy={policy} />
          </TabsContent>
        </Tabs>
      )}

      <PrivacyNote />
    </div>
  )
}
