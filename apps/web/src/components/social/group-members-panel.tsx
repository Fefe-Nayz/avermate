"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ChevronDownIcon,
  ShieldBanIcon,
  UserMinusIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { ReportDialog } from "@/components/social/report-dialog"
import {
  RoleBadge,
  SocialActions,
  SocialAlias,
  SocialList,
  SocialRow,
  SocialSection,
  useSocialLabels,
  type SocialRole,
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
import { SelectControl } from "@/components/forms/controls"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { orpc } from "@/lib/orpc"

interface MemberView {
  membershipId: string
  alias: string
  role: SocialRole
  state: "active" | "consent_required" | "left" | "removed"
  metrics: Record<
    string,
    { metric: string; numeric: number | null; band: string | null }
  >
}

/**
 * Who is in the group, and what the policy lets you see of them.
 *
 * Members are aliases by design, so they are drawn as aliases rather than
 * borrowed avatars. Moderation controls sit behind opening a member: five
 * controls per row, two of them destructive, turned a roster into a console.
 */
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
  viewerRole: SocialRole
  members: MemberView[]
}) {
  const t = useExtracted()
  const labels = useSocialLabels()
  const queryClient = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)

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

  return (
    <SocialSection
      icon={UsersRoundIcon}
      title={t("Members · {count}", { count: String(members.length) })}
      description={t(
        "Aliases and policy-approved summaries only. Owners and moderators receive no bypass."
      )}
      bodyClassName="p-0 px-4 py-1"
    >
      <SocialList>
        {members.map((member) => {
          const self = member.membershipId === viewerMembershipId
          const open = openId === member.membershipId
          const figures = Object.entries(member.metrics)

          return (
            <div key={member.membershipId} className="py-2.5">
              <SocialRow
                className="py-0"
                trailing={
                  <>
                    {member.state === "consent_required" ? (
                      <span className="rounded-full bg-caution/12 px-2 py-0.5 text-xs font-medium text-caution">
                        {t("Reconsent pending")}
                      </span>
                    ) : null}
                    <RoleBadge role={member.role} />
                    {self ? null : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("Member options")}
                        aria-expanded={open}
                        onClick={() =>
                          setOpenId(open ? null : member.membershipId)
                        }
                      >
                        <ChevronDownIcon
                          className={cn(
                            "transition-transform",
                            open && "rotate-180"
                          )}
                        />
                      </Button>
                    )}
                  </>
                }
              >
                <SocialAlias
                  alias={member.alias}
                  self={self}
                  secondary={
                    figures.length
                      ? null
                      : t("No member-visible figures for you")
                  }
                />
              </SocialRow>

              {figures.length ? (
                <dl className="mt-2 flex flex-wrap gap-1.5 pl-12">
                  {figures.map(([metric, projection]) => (
                    <div
                      key={metric}
                      className="rounded-lg bg-muted/60 px-2.5 py-1.5"
                    >
                      <dt className="text-[11px] text-muted-foreground">
                        {labels.metric(metric)}
                      </dt>
                      <dd className="numeric text-sm font-medium">
                        {projection.numeric !== null
                          ? `${projection.numeric.toFixed(1)}%`
                          : projection.band
                            ? labels.band(projection.band)
                            : t("Protected")}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {open && !self ? (
                <div className="mt-3 ml-12 rounded-xl border bg-muted/30 p-3">
                  <SocialActions>
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
                    />

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

                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={busy}
                          />
                        }
                      >
                        <ShieldBanIcon /> {t("Block")}
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
                  </SocialActions>
                </div>
              ) : null}
            </div>
          )
        })}
      </SocialList>

      {members.length === 0 ? (
        <Badge variant="outline" className="mb-3">
          {t("No participating members yet")}
        </Badge>
      ) : null}
    </SocialSection>
  )
}
