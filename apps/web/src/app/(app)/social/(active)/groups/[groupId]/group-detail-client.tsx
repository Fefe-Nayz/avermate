"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BookOpenIcon,
  CopyPlusIcon,
  CrownIcon,
  DoorOpenIcon,
  GaugeIcon,
  LinkIcon,
  MoveRightIcon,
  PencilIcon,
  SnowflakeIcon,
  Trash2Icon,
  TrendingDownIcon,
  TrendingUpIcon,
  TrophyIcon,
  UsersRoundIcon,
  UserXIcon,
  XIcon,
} from "lucide-react"
import { useExtracted, useLocale } from "next-intl"
import { toast } from "sonner"
import { ReportDialog } from "@/components/social/report-dialog"
import { useSocialLabels } from "@/components/social/social-labels"
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
import { Badge } from "@/components/ui/badge"
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
import { SelectControl } from "@/components/forms/controls"
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
  const labels = useSocialLabels()
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const detail = useQuery(
    orpc.social.groups.get.queryOptions({ input: { groupId } })
  )
  const years = useQuery(orpc.years.list.queryOptions())
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
  const [kind, setKind] = useState<"friends" | "study" | "class">("friends")
  const [scopeSubject, setScopeSubject] = useState("")
  const [adoptOpen, setAdoptOpen] = useState(false)
  const [adoptName, setAdoptName] = useState("")

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
  const adopt = useMutation({
    ...orpc.social.groups.adoptSetup.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setAdoptOpen(false)
      toast.success(
        t("Year created from the group's configuration. Find it in your year picker.")
      )
      await queryClient.invalidateQueries({
        queryKey: orpc.years.list.key(),
      })
    },
    onError: () => toast.error(t("The configuration could not be adopted.")),
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
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{labels.groupKind(group.kind)}</Badge>
        {group.comparedSubjectName ? (
          <Badge variant="secondary" className="gap-1">
            <BookOpenIcon className="size-3" aria-hidden />
            {t("Compares {name}", { name: group.comparedSubjectName })}
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1">
            <GaugeIcon className="size-3" aria-hidden />
            {t("Compares general averages")}
          </Badge>
        )}
      </div>
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
                  setKind(group.kind)
                  setScopeSubject(group.comparedSubjectName ?? "")
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
                  <div className="space-y-2">
                    <Label htmlFor="edit-group-kind">{t("Group type")}</Label>
                    <SelectControl
                      id="edit-group-kind"
                      value={kind}
                      onValueChange={(value) =>
                        setKind(value as "friends" | "study" | "class")
                      }
                      options={[
                        { value: "friends", label: t("Friends group") },
                        { value: "study", label: t("Study group") },
                        { value: "class", label: t("Class") },
                      ]}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-group-scope">
                      {t("What the leaderboard compares")}
                    </Label>
                    <Input
                      id="edit-group-scope"
                      value={scopeSubject}
                      onChange={(event) => setScopeSubject(event.target.value)}
                      placeholder={t("Empty = general average")}
                      maxLength={100}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "Name a subject — Maths, Physics — and each member is ranked on their own subjects matching that name."
                      )}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="edit-group-trend">
                      {t("Show each member's 30-day trend")}
                    </Label>
                    <Switch
                      id="edit-group-trend"
                      checked={group.showTrend}
                      onCheckedChange={(checked) =>
                        update.mutate({ groupId, showTrend: checked })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="edit-group-count">
                      {t("Show grade counts")}
                    </Label>
                    <Switch
                      id="edit-group-count"
                      checked={group.showGradeCount}
                      onCheckedChange={(checked) =>
                        update.mutate({ groupId, showGradeCount: checked })
                      }
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
                        kind,
                        comparedSubjectName: scopeSubject.trim() || null,
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
                    {member.trend ? (
                      member.trend === "up" ? (
                        <TrendingUpIcon
                          className="size-4 text-positive"
                          aria-label={t("Improving")}
                        />
                      ) : member.trend === "down" ? (
                        <TrendingDownIcon
                          className="size-4 text-negative"
                          aria-label={t("Declining")}
                        />
                      ) : (
                        <MoveRightIcon
                          className="size-4 text-muted-foreground"
                          aria-label={t("Stable")}
                        />
                      )
                    ) : null}
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
                  hint={
                    [
                      member.role === "owner" ? t("Owner") : null,
                      member.gradeCount !== null
                        ? member.gradeCount === 1
                          ? t("1 grade")
                          : t("{count} grades", {
                              count: String(member.gradeCount),
                            })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
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

      {!frozen ? (
        <SocialSection
          icon={CopyPlusIcon}
          title={t("Common configuration")}
          description={t(
            "An optional template year. Adopting copies its subjects, periods and custom averages into a fresh year of your own — never any grades."
          )}
        >
          {isOwner ? (
            <div className="space-y-2">
              <Label htmlFor="shared-setup-year">
                {t("Offer one of your years as the template")}
              </Label>
              <SelectControl
                id="shared-setup-year"
                value={group.sharedSetupYearId ?? "__none__"}
                onValueChange={(value) =>
                  update.mutate({
                    groupId,
                    sharedSetupYearId: value === "__none__" ? null : value,
                  })
                }
                options={[
                  { value: "__none__", label: t("No common configuration") },
                  ...(years.data ?? [])
                    .filter((year) => !year.archivedAt)
                    .map((year) => ({ value: year.id, label: year.name })),
                ]}
              />
            </div>
          ) : null}
          {group.sharedSetup ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {group.sharedSetup.yearName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "{subjects} subjects · {averages} custom averages · {periods} periods · /{scale}",
                    {
                      subjects: String(group.sharedSetup.subjectCount),
                      averages: String(group.sharedSetup.averageCount),
                      periods: String(group.sharedSetup.periodCount),
                      scale: String(group.sharedSetup.scale),
                    }
                  )}
                </p>
              </div>
              <Dialog
                open={adoptOpen}
                onOpenChange={(open) => {
                  setAdoptOpen(open)
                  if (open) setAdoptName(group.sharedSetup?.yearName ?? "")
                }}
              >
                <DialogTrigger
                  render={<Button type="button" size="sm" variant="outline" />}
                >
                  <CopyPlusIcon /> {t("Adopt this configuration")}
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("Adopt this configuration")}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label htmlFor="adopt-year-name">
                      {t("Name of your new year")}
                    </Label>
                    <Input
                      id="adopt-year-name"
                      value={adoptName}
                      onChange={(event) => setAdoptName(event.target.value)}
                      maxLength={100}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "A copy, not a subscription: if the template changes later, adopt it again."
                      )}
                    </p>
                  </div>
                  <DialogFooter>
                    <Button
                      disabled={adopt.isPending || !adoptName.trim()}
                      onClick={() =>
                        adopt.mutate({ groupId, name: adoptName.trim() })
                      }
                    >
                      {adopt.isPending ? <Spinner /> : null}
                      {t("Create my year")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("This group has no common configuration yet.")}
            </p>
          )}
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
