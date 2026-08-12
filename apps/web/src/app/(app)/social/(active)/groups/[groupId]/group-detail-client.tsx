"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CrownIcon,
  DoorOpenIcon,
  GaugeIcon,
  LinkIcon,
  PencilIcon,
  SnowflakeIcon,
  Trash2Icon,
  TrophyIcon,
  UsersRoundIcon,
  UserXIcon,
  XIcon,
} from "lucide-react"
import { useExtracted, useLocale } from "next-intl"
import { toast } from "sonner"
import { ReportDialog } from "@/components/social/report-dialog"
import { SecretLink } from "@/components/social/secret-link"
import {
  SharedAverage,
  SocialActions,
  SocialCallout,
  SocialEmpty,
  SocialHeading,
  SocialIdentity,
  SocialList,
  SocialRow,
  SocialSection,
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

/**
 * One group: the leaderboard, your own switch, and — for the owner — the
 * link and the membership. The board sorts sharers by average and lists
 * non-sharers after them, so declining to share is visible but not shameful.
 */
export function GroupDetailClient({ groupId }: { groupId: string }) {
  const t = useExtracted()
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const detail = useQuery(
    orpc.social.groups.get.queryOptions({ input: { groupId } })
  )
  const invitations = useQuery({
    ...orpc.social.groups.invitations.list.queryOptions({
      input: { groupId },
    }),
    enabled: detail.data?.viewer.role === "owner",
  })
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.get.key({ input: { groupId } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.key(),
      }),
    ])
  }

  const setSharing = useMutation({
    ...orpc.social.groups.setSharing.mutationOptions(),
    onSuccess: refresh,
  })
  const invite = useMutation({
    ...orpc.social.groups.invitations.create.mutationOptions(),
    onSuccess: async (invitation) => {
      haptic("success")
      setInviteUrl(
        `${window.location.origin}/social/invitations/${invitation.token}`
      )
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.invitations.list.key({
          input: { groupId },
        }),
      })
    },
  })
  const revokeInvite = useMutation({
    ...orpc.social.groups.invitations.revoke.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.invitations.list.key({
          input: { groupId },
        }),
      }),
  })
  const update = useMutation({
    ...orpc.social.groups.update.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setEditOpen(false)
      await refresh()
    },
  })
  const removeMember = useMutation({
    ...orpc.social.groups.removeMember.mutationOptions(),
    onSuccess: refresh,
  })
  const leave = useMutation({
    ...orpc.social.groups.leave.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.key(),
      })
      router.push("/social/groups")
    },
    onError: () =>
      toast.error(
        t("Transfer or remove the other members first, or delete the group.")
      ),
  })
  const destroy = useMutation({
    ...orpc.social.groups.delete.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.key(),
      })
      router.push("/social/groups")
    },
  })

  if (detail.isLoading && !detail.isError) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  const group = detail.data
  if (!group) {
    return (
      <SocialEmpty
        icon={UsersRoundIcon}
        title={t("This group could not be found")}
        description={t("It may have been deleted, or you were removed.")}
        action={
          <Button
            variant="outline"
            onClick={() => router.push("/social/groups")}
          >
            {t("Back to groups")}
          </Button>
        }
      />
    )
  }

  const isOwner = group.viewer.role === "owner"
  const frozen = group.state === "frozen"
  const sharers = group.members
    .filter((member) => member.average !== null)
    .sort((left, right) => (right.average ?? 0) - (left.average ?? 0))
  const silent = group.members.filter((member) => member.average === null)

  // Everything a stats row needs is already in the payload: the shared
  // ratios. Median and range are computed here rather than asked for.
  const ratios = sharers
    .map((member) => member.average as number)
    .sort((left, right) => left - right)
  const median =
    ratios.length === 0
      ? null
      : ratios.length % 2 === 1
        ? (ratios[(ratios.length - 1) / 2] ?? null)
        : ((ratios[ratios.length / 2 - 1] ?? 0) +
            (ratios[ratios.length / 2] ?? 0)) /
          2
  const statScale = sharers[0]?.scale ?? 20
  const statDecimals = sharers[0]?.decimals ?? 2

  return (
    <div className="flex flex-col gap-4">
      <SocialHeading
        icon={UsersRoundIcon}
        title={group.name}
        description={group.description || undefined}
        action={
          isOwner && !frozen ? (
            <Dialog
              open={editOpen}
              onOpenChange={(open) => {
                setEditOpen(open)
                if (open) {
                  setName(group.name)
                  setDescription(group.description)
                }
              }}
            >
              <DialogTrigger
                render={<Button type="button" size="sm" variant="outline" />}
              >
                <PencilIcon /> {t("Edit")}
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("Edit the group")}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="edit-group-name">{t("Group name")}</Label>
                    <Input
                      id="edit-group-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={100}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-group-description">
                      {t("Description (optional)")}
                    </Label>
                    <Textarea
                      id="edit-group-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      maxLength={500}
                      rows={3}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    disabled={update.isPending || name.trim().length < 2}
                    onClick={() =>
                      update.mutate({
                        groupId,
                        name: name.trim(),
                        description: description.trim(),
                      })
                    }
                  >
                    {update.isPending ? <Spinner /> : null}
                    {t("Save")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : undefined
        }
      />

      {frozen ? (
        <SocialCallout tone="caution" title={t("This group is on hold")}>
          {t(
            "A moderator paused it after a report. Figures are hidden until the hold is lifted; nothing has been deleted."
          )}
        </SocialCallout>
      ) : (
        <SocialSection
          icon={GaugeIcon}
          title={t("Your average in this group")}
          description={t(
            "One switch. Off means the others see you in the list without a figure."
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">
              {group.viewer.shareAverage
                ? t("Your general average is visible to this group.")
                : t("Your general average is hidden from this group.")}
            </span>
            <Switch
              checked={group.viewer.shareAverage}
              disabled={setSharing.isPending}
              onCheckedChange={(checked) =>
                setSharing.mutate({ groupId, shareAverage: checked })
              }
              aria-label={t("Share my average with this group")}
            />
          </div>
        </SocialSection>
      )}

      {!frozen && ratios.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: t("Group average"), value: group.groupAverage },
            { label: t("Median"), value: median },
            {
              label: t("Range"),
              value: null,
              range: [ratios[0] ?? null, ratios.at(-1) ?? null] as const,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col gap-1 rounded-xl border bg-card p-4"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {stat.label}
              </span>
              {stat.range ? (
                <span className="flex items-baseline gap-1.5">
                  <SharedAverage
                    ratio={stat.range[0]}
                    scale={statScale}
                    decimals={statDecimals}
                    locale={locale}
                  />
                  <span className="text-xs text-muted-foreground">→</span>
                  <SharedAverage
                    ratio={stat.range[1]}
                    scale={statScale}
                    decimals={statDecimals}
                    locale={locale}
                  />
                </span>
              ) : (
                <SharedAverage
                  ratio={stat.value}
                  scale={statScale}
                  decimals={statDecimals}
                  locale={locale}
                  className="text-lg"
                />
              )}
            </div>
          ))}
        </div>
      ) : null}

      <SocialSection
        icon={TrophyIcon}
        title={t("Leaderboard")}
        description={
          ratios.length > 0
            ? t("{count} of {total} members share their figure.", {
                count: String(ratios.length),
                total: String(group.members.length),
              })
            : t("Averages appear as members turn their switch on.")
        }
      >
        {group.members.length ? (
          <SocialList>
            {[...sharers, ...silent].map((member, index) => (
              <SocialRow
                key={member.membershipId}
                leading={
                  member.average !== null ? (
                    <span className="numeric w-6 text-center text-sm font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                  ) : (
                    <span className="w-6" aria-hidden />
                  )
                }
                trailing={
                  <div className="flex items-center gap-2">
                    {member.average !== null ? (
                      <SharedAverage
                        ratio={member.average}
                        scale={member.scale ?? 20}
                        decimals={member.decimals ?? 2}
                        locale={locale}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("Not shared")}
                      </span>
                    )}
                    {isOwner && member.role !== "owner" && !frozen ? (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("Remove from group")}
                        disabled={removeMember.isPending}
                        onClick={() =>
                          removeMember.mutate({
                            groupId,
                            membershipId: member.membershipId,
                          })
                        }
                      >
                        <UserXIcon />
                      </Button>
                    ) : null}
                  </div>
                }
              >
                <SocialIdentity
                  name={member.name}
                  handle={member.handle}
                  avatarUrl={member.avatar}
                  hint={member.role === "owner" ? t("Owner") : undefined}
                />
              </SocialRow>
            ))}
          </SocialList>
        ) : null}
      </SocialSection>

      {!frozen ? (
        <SocialSection
          icon={LinkIcon}
          title={t("Invite people")}
          description={t(
            "Anyone with the link joins directly. It works for a month or until revoked."
          )}
        >
          <SocialActions>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={invite.isPending}
              onClick={() => invite.mutate({ groupId })}
            >
              {invite.isPending ? <Spinner /> : <LinkIcon />}
              {t("Create an invitation link")}
            </Button>
          </SocialActions>
          {inviteUrl ? (
            <SecretLink url={inviteUrl} label={t("Group invitation link")} />
          ) : null}
          {isOwner && invitations.data?.length ? (
            <SocialList>
              {invitations.data.map((invitation) => (
                <SocialRow
                  key={invitation.id}
                  trailing={
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={revokeInvite.isPending}
                      onClick={() =>
                        revokeInvite.mutate({
                          groupId,
                          invitationId: invitation.id,
                        })
                      }
                    >
                      <XIcon /> {t("Revoke")}
                    </Button>
                  }
                >
                  <p className="font-mono text-xs">{invitation.tokenPrefix}…</p>
                  <p className="text-xs text-muted-foreground">
                    {t("{count} joins · by {name}", {
                      count: String(invitation.useCount),
                      name: invitation.createdBy,
                    })}
                  </p>
                </SocialRow>
              ))}
            </SocialList>
          ) : null}
        </SocialSection>
      ) : null}

      <SocialActions>
        {isOwner ? (
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button type="button" size="sm" variant="outline" />}
            >
              <Trash2Icon /> {t("Delete group")}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("Delete this group?")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t(
                    "The group and its memberships disappear for everyone. Nobody's grades are affected."
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => destroy.mutate({ groupId })}
                >
                  {t("Delete group")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={leave.isPending}
            onClick={() => leave.mutate({ groupId })}
          >
            <DoorOpenIcon /> {t("Leave group")}
          </Button>
        )}
        <ReportDialog groupId={groupId} />
        {isOwner ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CrownIcon className="size-3" aria-hidden />
            {t("You own this group.")}
          </span>
        ) : null}
        {frozen ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <SnowflakeIcon className="size-3" aria-hidden />
            {t("On hold")}
          </span>
        ) : null}
      </SocialActions>
    </div>
  )
}
