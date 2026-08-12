"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CopyPlusIcon,
  CrownIcon,
  DoorOpenIcon,
  LinkIcon,
  MoveRightIcon,
  PencilIcon,
  PlusIcon,
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
import {
  PresetVisualEditor,
  type PresetEditorConfiguration,
} from "@/components/admin/preset-visual-editor"
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
import { cn } from "@/lib/utils"
import { orpc } from "@/lib/orpc"

type ComparisonKind =
  | "general"
  | "subject"
  | "median"
  | "passRate"
  | "goalProgress"

/** The builder needs a starting point; one plain subject is the smallest. */
function emptyConfiguration(): PresetEditorConfiguration {
  return {
    subjects: [
      {
        key: `subject:${crypto.randomUUID().replaceAll("-", "")}`,
        name: "Matière 1",
        kind: "subject",
        isMain: false,
        coefficient: 1,
        children: [],
      },
    ],
    averages: [],
  }
}

/** Percent metrics carry no denominator; everything else sits on a scale. */
function unitOf(kind: string): "scale" | "percent" {
  return kind === "passRate" || kind === "goalProgress" ? "percent" : "scale"
}

/**
 * One group: several boards side by side — pick a comparison chip and the
 * leaderboard, stats and trends follow it. The owner composes the boards
 * from the metric palette and real subject names; each member's only lock
 * stays their own switch.
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
  const [adoptOpen, setAdoptOpen] = useState(false)
  const [adoptName, setAdoptName] = useState("")
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderDraft, setBuilderDraft] =
    useState<PresetEditorConfiguration | null>(null)
  const [presetOpen, setPresetOpen] = useState(false)
  const presets = useQuery({
    ...orpc.presets.list.queryOptions(),
    enabled: presetOpen,
  })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [addKind, setAddKind] = useState<ComparisonKind>("subject")
  const [addSubject, setAddSubject] = useState("")

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
  const addComparison = useMutation({
    ...orpc.social.groups.comparisons.add.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setAddSubject("")
      await refresh()
    },
    onError: () => toast.error(t("That comparison already exists.")),
  })
  const removeComparison = useMutation({
    ...orpc.social.groups.comparisons.remove.mutationOptions(),
    onSuccess: refresh,
  })
  const adopt = useMutation({
    ...orpc.social.groups.adoptSetup.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setAdoptOpen(false)
      toast.success(
        t(
          "Year created from the group's configuration. Find it in your year picker."
        )
      )
      await queryClient.invalidateQueries({ queryKey: orpc.years.list.key() })
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
  const comparisons = group.comparisons
  const active =
    comparisons.find((entry) => entry.id === activeId) ?? comparisons[0]
  const activeUnit = active ? unitOf(active.kind) : "scale"

  const figureOf = (member: (typeof group.members)[number]) =>
    active
      ? (member.figures.find((figure) => figure.scopeId === active.id) ?? null)
      : null
  const sharers = group.members
    .filter((member) => figureOf(member)?.average != null)
    .sort(
      (left, right) =>
        (figureOf(right)?.average ?? 0) - (figureOf(left)?.average ?? 0)
    )
  const silent = group.members.filter(
    (member) => figureOf(member)?.average == null
  )
  const ratios = sharers
    .map((member) => figureOf(member)?.average as number)
    .sort((left, right) => left - right)
  const mean =
    ratios.length === 0
      ? null
      : ratios.reduce((total, value) => total + value, 0) / ratios.length
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

  const kindOptions: Array<{ value: ComparisonKind; label: string }> = [
    { value: "subject", label: t("A subject") },
    { value: "general", label: t("General average") },
    { value: "median", label: t("Median grade") },
    { value: "passRate", label: t("Pass rate") },
    { value: "goalProgress", label: t("Goals achieved") },
  ]

  return (
    <div className="flex flex-col gap-4">
      <SocialHeading
        icon={UsersRoundIcon}
        title={group.name}
        description={
          [labels.groupKind(group.kind), group.description]
            .filter(Boolean)
            .join(" · ") || undefined
        }
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
          icon={TrophyIcon}
          title={t("Your figures in this group")}
          description={t(
            "One switch. Off means the others see you in the list without figures."
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">
              {group.viewer.shareAverage
                ? t("Your figures are visible to this group.")
                : t("Your figures are hidden from this group.")}
            </span>
            <Switch
              checked={group.viewer.shareAverage}
              disabled={setSharing.isPending}
              onCheckedChange={(checked) =>
                setSharing.mutate({ groupId, shareAverage: checked })
              }
              aria-label={t("Share my figures with this group")}
            />
          </div>
        </SocialSection>
      )}

      <SocialSection
        icon={TrophyIcon}
        title={t("Boards")}
        description={
          isOwner
            ? t("Members see every board. Pick one to read; add from the palette below.")
            : t("Pick a board — the ranking follows it.")
        }
      >
        <div className="flex flex-wrap gap-2">
          {comparisons.map((entry) => {
            const isActive = active?.id === entry.id
            return (
              <span key={entry.id} className="inline-flex items-center">
                <button
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setActiveId(entry.id)}
                  className={cn(
                    "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                    isOwner && !frozen && comparisons.length > 1
                      ? "rounded-r-none border-r-0"
                      : "",
                    isActive
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "hover:bg-accent/60"
                  )}
                >
                  {labels.comparison(entry.kind, entry.subjectName)}
                </button>
                {isOwner && !frozen && comparisons.length > 1 ? (
                  <button
                    type="button"
                    aria-label={t("Remove this board")}
                    disabled={removeComparison.isPending}
                    onClick={() =>
                      removeComparison.mutate({
                        groupId,
                        comparisonId: entry.id,
                      })
                    }
                    className={cn(
                      "inline-flex min-h-8 items-center rounded-r-full border border-l-0 pr-2.5 pl-1 text-muted-foreground transition-colors hover:text-destructive",
                      isActive ? "border-primary bg-primary/10" : ""
                    )}
                  >
                    <XIcon className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </span>
            )
          })}
        </div>

        {isOwner && !frozen ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44 space-y-2">
              <Label htmlFor="add-comparison-kind">{t("Add a board")}</Label>
              <SelectControl
                id="add-comparison-kind"
                value={addKind}
                onValueChange={(value) => setAddKind(value as ComparisonKind)}
                options={kindOptions}
              />
            </div>
            {addKind === "subject" ? (
              <div className="min-w-44 flex-1 space-y-2">
                <Label htmlFor="add-comparison-subject">{t("Subject")}</Label>
                <SelectControl
                  id="add-comparison-subject"
                  value={addSubject}
                  onValueChange={setAddSubject}
                  placeholder={t("Choose a subject…")}
                  options={group.availableSubjects.map((name) => ({
                    value: name,
                    label: name,
                  }))}
                />
              </div>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={
                addComparison.isPending ||
                (addKind === "subject" && !addSubject)
              }
              onClick={() =>
                addComparison.mutate({
                  groupId,
                  kind: addKind,
                  subjectName: addKind === "subject" ? addSubject : undefined,
                })
              }
            >
              {addComparison.isPending ? <Spinner /> : <PlusIcon />}
              {t("Add")}
            </Button>
            {addKind === "subject" && group.availableSubjects.length === 0 ? (
              <p className="w-full text-xs text-muted-foreground">
                {t(
                  "The picker lists the template year's subjects, or yours. Offer a common configuration below to widen it."
                )}
              </p>
            ) : null}
          </div>
        ) : null}
      </SocialSection>

      {!frozen && active && ratios.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: t("Group average"), value: mean, range: null },
            { label: t("Median"), value: median, range: null },
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
                    unit={activeUnit}
                  />
                  <span className="text-xs text-muted-foreground">→</span>
                  <SharedAverage
                    ratio={stat.range[1]}
                    scale={statScale}
                    decimals={statDecimals}
                    locale={locale}
                    unit={activeUnit}
                  />
                </span>
              ) : (
                <SharedAverage
                  ratio={stat.value}
                  scale={statScale}
                  decimals={statDecimals}
                  locale={locale}
                  unit={activeUnit}
                  className="text-lg"
                />
              )}
            </div>
          ))}
        </div>
      ) : null}

      <SocialSection
        icon={TrophyIcon}
        title={
          active
            ? t("Leaderboard — {name}", {
                name: labels.comparison(active.kind, active.subjectName),
              })
            : t("Leaderboard")
        }
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
            {[...sharers, ...silent].map((member, index) => {
              const figure = figureOf(member)
              return (
                <SocialRow
                  key={member.membershipId}
                  leading={
                    figure?.average != null ? (
                      <span className="numeric w-6 text-center text-sm font-semibold text-muted-foreground">
                        {index + 1}
                      </span>
                    ) : (
                      <span className="w-6" aria-hidden />
                    )
                  }
                  trailing={
                    <div className="flex items-center gap-2">
                      {figure?.trend ? (
                        figure.trend === "up" ? (
                          <TrendingUpIcon
                            className="size-4 text-positive"
                            aria-label={t("Improving")}
                          />
                        ) : figure.trend === "down" ? (
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
                      {figure?.average != null ? (
                        <SharedAverage
                          ratio={figure.average}
                          scale={member.scale ?? 20}
                          decimals={member.decimals ?? 2}
                          locale={locale}
                          unit={activeUnit}
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
                        figure?.gradeCount != null
                          ? figure.gradeCount === 1
                            ? t("1 grade")
                            : t("{count} grades", {
                                count: String(figure.gradeCount),
                              })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                  />
                </SocialRow>
              )
            })}
          </SocialList>
        ) : null}
      </SocialSection>

      {!frozen ? (
        <SocialSection
          icon={CopyPlusIcon}
          title={t("Common configuration")}
          description={t(
            "An optional template year. Adopting copies its subjects, periods and custom averages into a fresh year of your own — never any grades."
          )}
        >
          {isOwner ? (
            <div className="flex flex-col gap-3">
              <div className="space-y-2">
                <Label htmlFor="shared-setup-source">{t("Template")}</Label>
                <SelectControl
                  id="shared-setup-source"
                  value={
                    group.sharedSetupYearId ??
                    (group.sharedSetup?.source === "builder"
                      ? "__builder__"
                      : "__none__")
                  }
                  onValueChange={(value) => {
                    if (value === "__none__") {
                      update.mutate({
                        groupId,
                        sharedSetupYearId: null,
                        sharedSetupConfig: null,
                      })
                    } else if (value === "__builder__") {
                      setBuilderDraft(
                        (group.sharedSetupDraft as PresetEditorConfiguration | null) ??
                          emptyConfiguration()
                      )
                      setBuilderOpen(true)
                    } else if (value === "__preset__") {
                      setPresetOpen(true)
                    } else {
                      update.mutate({ groupId, sharedSetupYearId: value })
                    }
                  }}
                  options={[
                    { value: "__none__", label: t("No common configuration") },
                    {
                      value: "__builder__",
                      label: t("Build a configuration by hand"),
                    },
                    {
                      value: "__preset__",
                      label: t("Start from a curated preset"),
                    },
                    ...(years.data ?? [])
                      .filter((year) => !year.archivedAt)
                      .map((year) => ({
                        value: year.id,
                        label: t("My year: {name}", { name: year.name }),
                      })),
                  ]}
                />
              </div>
              {group.sharedSetup?.source === "builder" ? (
                <SocialActions>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setBuilderDraft(
                        (group.sharedSetupDraft as PresetEditorConfiguration | null) ??
                          emptyConfiguration()
                      )
                      setBuilderOpen(true)
                    }}
                  >
                    <PencilIcon /> {t("Edit the configuration")}
                  </Button>
                </SocialActions>
              ) : null}

              <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>{t("Configuration builder")}</DialogTitle>
                  </DialogHeader>
                  {builderDraft ? (
                    <PresetVisualEditor
                      value={builderDraft}
                      onChange={setBuilderDraft}
                    />
                  ) : null}
                  <DialogFooter>
                    <Button
                      disabled={
                        update.isPending ||
                        !builderDraft ||
                        builderDraft.subjects.length === 0
                      }
                      onClick={() => {
                        if (!builderDraft) return
                        update.mutate(
                          { groupId, sharedSetupConfig: builderDraft },
                          { onSuccess: () => setBuilderOpen(false) }
                        )
                      }}
                    >
                      {update.isPending ? <Spinner /> : null}
                      {t("Save the configuration")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={presetOpen} onOpenChange={setPresetOpen}>
                <DialogContent className="max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{t("Start from a curated preset")}</DialogTitle>
                  </DialogHeader>
                  {presets.isLoading ? (
                    <div className="flex justify-center py-8">
                      <Spinner />
                    </div>
                  ) : (
                    <SocialList>
                      {(presets.data ?? []).map((preset) => (
                        <SocialRow
                          key={preset.id}
                          trailing={
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={update.isPending}
                              onClick={() =>
                                update.mutate(
                                  {
                                    groupId,
                                    sharedSetupFromPresetId: preset.id,
                                  },
                                  { onSuccess: () => setPresetOpen(false) }
                                )
                              }
                            >
                              {t("Use")}
                            </Button>
                          }
                        >
                          <p className="truncate text-sm font-medium">
                            {preset.name}
                          </p>
                          {preset.description ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {preset.description}
                            </p>
                          ) : null}
                        </SocialRow>
                      ))}
                    </SocialList>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "The preset is copied into the group; you can adjust it in the builder afterwards."
                    )}
                  </p>
                </DialogContent>
              </Dialog>
            </div>
          ) : null}
          {group.sharedSetup ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {group.sharedSetup.yearName ?? t("Built configuration")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {group.sharedSetup.source === "year"
                    ? t(
                        "{subjects} subjects · {averages} custom averages · {periods} periods · /{scale}",
                        {
                          subjects: String(group.sharedSetup.subjectCount),
                          averages: String(group.sharedSetup.averageCount),
                          periods: String(group.sharedSetup.periodCount),
                          scale: String(group.sharedSetup.scale),
                        }
                      )
                    : t("{subjects} subjects · {averages} custom averages", {
                        subjects: String(group.sharedSetup.subjectCount),
                        averages: String(group.sharedSetup.averageCount),
                      })}
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
          <Badge variant="outline" className="gap-1">
            <SnowflakeIcon className="size-3" aria-hidden />
            {t("On hold")}
          </Badge>
        ) : null}
      </SocialActions>
    </div>
  )
}
