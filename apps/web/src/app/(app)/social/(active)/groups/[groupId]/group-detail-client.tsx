"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BookCopyIcon,
  CalendarRangeIcon,
  CircleCheckIcon,
  CrownIcon,
  DoorOpenIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  SchoolIcon,
  SnowflakeIcon,
  Trash2Icon,
  TrophyIcon,
  UserXIcon,
  XIcon,
} from "lucide-react"
import { useExtracted, useLocale } from "next-intl"
import { toast } from "sonner"
import { ReportDialog } from "@/components/social/report-dialog"
import { SecretLink } from "@/components/social/secret-link"
import { useSocialLabels } from "@/components/social/social-labels"
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
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { orpc } from "@/lib/orpc"

type ComparisonKind = "general" | "subject"

function unitOf(kind: string): "scale" | "percent" {
  return kind === "passRate" || kind === "goalProgress" ? "percent" : "scale"
}

/** A class is one frozen academic model and one explicitly linked year per member. */
export function GroupDetailClient({ groupId }: { groupId: string }) {
  const t = useExtracted()
  const locale = useLocale()
  const labels = useSocialLabels()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { years } = useYear()
  const detail = useQuery(
    orpc.social.groups.get.queryOptions({ input: { groupId } })
  )
  const invitations = useQuery({
    ...orpc.social.groups.invitations.list.queryOptions({ input: { groupId } }),
    enabled: detail.data?.viewer.role === "owner",
  })

  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [addKind, setAddKind] = useState<ComparisonKind>("subject")
  const [addSubjectKey, setAddSubjectKey] = useState("")
  const [selectedYearId, setSelectedYearId] = useState("")
  const [legacyTemplateYearId, setLegacyTemplateYearId] = useState("")
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyName, setCopyName] = useState("")

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

  const update = useMutation({
    ...orpc.social.groups.update.mutationOptions(),
    onSuccess: refresh,
  })
  const configureClass = useMutation({
    ...orpc.social.groups.configureClass.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const selectYear = useMutation({
    ...orpc.social.groups.selectYear.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Year connected. Sharing remains off."))
      await refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const adopt = useMutation({
    ...orpc.social.groups.adoptSetup.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setCopyOpen(false)
      toast.success(t("A new year was created and connected to this class."))
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: orpc.years.list.key() }),
      ])
    },
    onError: (error) => toast.error(error.message),
  })
  const setSharing = useMutation({
    ...orpc.social.groups.setSharing.mutationOptions(),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  })
  const addComparison = useMutation({
    ...orpc.social.groups.comparisons.add.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setAddSubjectKey("")
      await refresh()
    },
    onError: () => toast.error(t("That comparison already exists.")),
  })
  const removeComparison = useMutation({
    ...orpc.social.groups.comparisons.remove.mutationOptions(),
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
  const removeMember = useMutation({
    ...orpc.social.groups.removeMember.mutationOptions(),
    onSuccess: refresh,
  })
  const leave = useMutation({
    ...orpc.social.groups.leave.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.key(),
      })
      router.push("/social/groups")
    },
    onError: () =>
      toast.error(
        t("Remove the other members first, or delete the class.")
      ),
  })
  const destroy = useMutation({
    ...orpc.social.groups.delete.mutationOptions(),
    onSuccess: async () => {
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
        icon={SchoolIcon}
        title={t("This class could not be found")}
        description={t("It may have been deleted, or you were removed.")}
        action={
          <Button
            variant="outline"
            onClick={() => router.push("/social/groups")}
          >
            {t("Back to classes")}
          </Button>
        }
      />
    )
  }

  const isOwner = group.viewer.role === "owner"
  const frozen = group.state === "frozen"
  const template = group.classTemplate
  const linkedYear = years.find((year) => year.id === group.viewer.yearId)
  const compatibleYearId =
    selectedYearId ||
    group.compatibleYears.find((year) => year.id === group.viewer.yearId)?.id ||
    group.compatibleYears[0]?.id ||
    ""
  const legacyYearId = legacyTemplateYearId || years[0]?.id || ""
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
  const mean = ratios.length
    ? ratios.reduce((total, value) => total + value, 0) / ratios.length
    : null
  const statScale = sharers[0]?.scale ?? 20
  const statDecimals = sharers[0]?.decimals ?? 2
  const date = (value: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(value)
    )

  return (
    <div className="flex flex-col gap-4">
      <SocialHeading
        icon={SchoolIcon}
        title={group.name}
        description={group.description || t("Class")}
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
                  <DialogTitle>{t("Edit the class")}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="edit-class-name">{t("Class name")}</Label>
                    <Input
                      id="edit-class-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={100}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-class-description">
                      {t("Description (optional)")}
                    </Label>
                    <Textarea
                      id="edit-class-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      maxLength={500}
                      rows={3}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="edit-class-trend">
                      {t("Show each member's 30-day trend")}
                    </Label>
                    <Switch
                      id="edit-class-trend"
                      checked={group.showTrend}
                      onCheckedChange={(showTrend) =>
                        update.mutate({ groupId, showTrend })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="edit-class-count">
                      {t("Show grade counts")}
                    </Label>
                    <Switch
                      id="edit-class-count"
                      checked={group.showGradeCount}
                      onCheckedChange={(showGradeCount) =>
                        update.mutate({ groupId, showGradeCount })
                      }
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    disabled={update.isPending || name.trim().length < 2}
                    onClick={() =>
                      update.mutate(
                        {
                          groupId,
                          name: name.trim(),
                          description: description.trim(),
                        },
                        { onSuccess: () => setEditOpen(false) }
                      )
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
        <SocialCallout tone="caution" title={t("This class is on hold")}>
          {t(
            "A moderator paused it after a report. Figures are hidden until the hold is lifted; nothing has been deleted."
          )}
        </SocialCallout>
      ) : null}

      <SocialSection
        icon={CalendarRangeIcon}
        title={t("Class model")}
        description={t(
          "The shared subjects, periods and grading scale are fixed for this class."
        )}
      >
        {template ? (
          <div className="rounded-lg border bg-muted/40 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{template.yearName}</p>
              <Badge variant="outline">
                {template.source === "preset"
                  ? t("Preset model")
                  : t("Custom model")}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("{start} – {end} · /{scale}", {
                start: date(template.startsAt),
                end: date(template.endsAt),
                scale: String(template.scale),
              })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                "{subjects} subjects · {averages} custom averages · {periods} periods",
                {
                  subjects: String(template.subjectCount),
                  averages: String(template.averageCount),
                  periods: String(template.periodCount),
                }
              )}
            </p>
          </div>
        ) : isOwner ? (
          <div className="flex flex-col gap-3">
            <SocialCallout tone="caution" title={t("Choose the class model")}>
              {t(
                "This class must be connected to one of your years before it can be used. The choice cannot be changed later."
              )}
            </SocialCallout>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-52 flex-1 space-y-2">
                <Label htmlFor="legacy-class-year">{t("Model year")}</Label>
                <SelectControl
                  id="legacy-class-year"
                  value={legacyYearId}
                  onValueChange={setLegacyTemplateYearId}
                  options={years.map((year) => ({
                    value: year.id,
                    label: year.name,
                  }))}
                />
              </div>
              <Button
                disabled={configureClass.isPending || !legacyYearId}
                onClick={() =>
                  configureClass.mutate({
                    groupId,
                    templateYearId: legacyYearId,
                  })
                }
              >
                {configureClass.isPending ? <Spinner /> : <SchoolIcon />}
                {t("Configure class")}
              </Button>
            </div>
          </div>
        ) : (
          <SocialCallout tone="caution" title={t("Class setup incomplete")}>
            {t(
              "The owner must choose a model year before the class can be used."
            )}
          </SocialCallout>
        )}
      </SocialSection>

      {template ? (
        <SocialSection
          icon={CircleCheckIcon}
          title={t("Your year in this class")}
          description={t(
            "Only the year connected here is used for class comparisons."
          )}
        >
          {group.viewer.yearStatus === "connected" ? (
            <SocialCallout tone="positive" title={t("Year connected")}>
              {linkedYear?.name ?? template.yearName}
            </SocialCallout>
          ) : (
            <SocialCallout tone="caution" title={t("Choose a compatible year")}>
              {group.viewer.yearStatus === "incompatible"
                ? t(
                    "Your previously connected year no longer matches this class. Choose another one or create a fresh copy."
                  )
                : t(
                    "Connect a compatible year before sharing results with the class."
                  )}
            </SocialCallout>
          )}

          <div className="flex flex-wrap items-end gap-2">
            {group.compatibleYears.length ? (
              <div className="min-w-52 flex-1 space-y-2">
                <Label htmlFor="class-year">{t("Compatible year")}</Label>
                <SelectControl
                  id="class-year"
                  value={compatibleYearId}
                  onValueChange={setSelectedYearId}
                  options={group.compatibleYears.map((year) => ({
                    value: year.id,
                    label: year.name,
                  }))}
                />
              </div>
            ) : null}
            {group.compatibleYears.length ? (
              <Button
                variant="outline"
                disabled={
                  selectYear.isPending ||
                  !compatibleYearId ||
                  compatibleYearId === group.viewer.yearId
                }
                onClick={() =>
                  selectYear.mutate({ groupId, yearId: compatibleYearId })
                }
              >
                {selectYear.isPending ? <Spinner /> : <CircleCheckIcon />}
                {t("Connect year")}
              </Button>
            ) : null}
            <Dialog
              open={copyOpen}
              onOpenChange={(open) => {
                setCopyOpen(open)
                if (open) setCopyName(template.yearName)
              }}
            >
              <DialogTrigger
                render={<Button type="button" variant="outline" />}
              >
                <BookCopyIcon /> {t("Create a new year")}
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {t("Create a year from this class")}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="class-copy-name">{t("New year name")}</Label>
                  <Input
                    id="class-copy-name"
                    value={copyName}
                    onChange={(event) => setCopyName(event.target.value)}
                    maxLength={100}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "A separate empty year is created and connected. Existing years and grades are never changed."
                    )}
                  </p>
                </div>
                <DialogFooter>
                  <Button
                    disabled={adopt.isPending || !copyName.trim()}
                    onClick={() =>
                      adopt.mutate({ groupId, name: copyName.trim() })
                    }
                  >
                    {adopt.isPending ? <Spinner /> : <BookCopyIcon />}
                    {t("Create and connect")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </SocialSection>
      ) : null}

      {template && !frozen ? (
        <SocialSection
          icon={TrophyIcon}
          title={t("Share in class comparisons")}
          description={t(
            "Sharing is optional and only uses the compatible year connected above."
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">
              {group.viewer.yearStatus !== "connected"
                ? t("Connect a compatible year to enable sharing.")
                : group.viewer.shareAverage
                  ? t("Your figures are visible to this class.")
                  : t("Your figures are hidden from this class.")}
            </span>
            <Switch
              checked={group.viewer.shareAverage}
              disabled={
                setSharing.isPending || group.viewer.yearStatus !== "connected"
              }
              onCheckedChange={(shareAverage) =>
                setSharing.mutate({ groupId, shareAverage })
              }
              aria-label={t("Share my figures with this class")}
            />
          </div>
        </SocialSection>
      ) : null}

      {template ? (
        <SocialSection
          icon={TrophyIcon}
          title={t("Comparisons")}
          description={t(
            "Compare the general average or a subject from the shared class model."
          )}
        >
          <div className="flex flex-wrap gap-2">
            {comparisons.map((entry) => {
              const selected = active?.id === entry.id
              return (
                <span key={entry.id} className="inline-flex items-center">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setActiveId(entry.id)}
                    className={cn(
                      "inline-flex min-h-8 items-center rounded-full border px-3 text-sm transition-colors",
                      isOwner && !frozen && comparisons.length > 1
                        ? "rounded-r-none border-r-0"
                        : "",
                      selected
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "hover:bg-accent/60"
                    )}
                  >
                    {labels.comparison(entry.kind, entry.subjectName)}
                  </button>
                  {isOwner && !frozen && comparisons.length > 1 ? (
                    <button
                      type="button"
                      aria-label={t("Remove this comparison")}
                      disabled={removeComparison.isPending}
                      onClick={() =>
                        removeComparison.mutate({
                          groupId,
                          comparisonId: entry.id,
                        })
                      }
                      className={cn(
                        "inline-flex min-h-8 items-center rounded-r-full border border-l-0 pr-2.5 pl-1 text-muted-foreground hover:text-destructive",
                        selected ? "border-primary bg-primary/10" : ""
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
                <Label htmlFor="add-comparison-kind">
                  {t("Add a comparison")}
                </Label>
                <SelectControl
                  id="add-comparison-kind"
                  value={addKind}
                  onValueChange={(value) => setAddKind(value as ComparisonKind)}
                  options={[
                    { value: "general", label: t("General average") },
                    { value: "subject", label: t("A subject") },
                  ]}
                />
              </div>
              {addKind === "subject" ? (
                <div className="min-w-44 flex-1 space-y-2">
                  <Label htmlFor="add-comparison-subject">{t("Subject")}</Label>
                  <SelectControl
                    id="add-comparison-subject"
                    value={addSubjectKey}
                    onValueChange={setAddSubjectKey}
                    placeholder={t("Choose a subject…")}
                    options={group.availableSubjectOptions.map((subject) => ({
                      value: subject.key,
                      label: subject.name,
                    }))}
                  />
                </div>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={
                  addComparison.isPending ||
                  (addKind === "subject" && !addSubjectKey)
                }
                onClick={() =>
                  addComparison.mutate({
                    groupId,
                    kind: addKind,
                    subjectKey:
                      addKind === "subject" ? addSubjectKey : undefined,
                  })
                }
              >
                {addComparison.isPending ? <Spinner /> : <PlusIcon />}
                {t("Add")}
              </Button>
            </div>
          ) : null}
        </SocialSection>
      ) : null}

      {!frozen && active && ratios.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
            <span className="text-xs font-medium text-muted-foreground">
              {t("Class average")}
            </span>
            <SharedAverage
              ratio={mean}
              scale={statScale}
              decimals={statDecimals}
              locale={locale}
              unit={activeUnit}
              className="text-lg"
            />
          </div>
          <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
            <span className="text-xs font-medium text-muted-foreground">
              {t("Participation")}
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {t("{count} of {total}", {
                count: String(ratios.length),
                total: String(group.members.length),
              })}
            </span>
          </div>
        </div>
      ) : null}

      {template ? (
        <SocialSection
          icon={SchoolIcon}
          title={
            active
              ? t("Class leaderboard — {name}", {
                  name: labels.comparison(active.kind, active.subjectName),
                })
              : t("Class members")
          }
          description={
            ratios.length
              ? t("Only members who opted in appear with a figure.")
              : t("No class figures are shared yet.")
          }
        >
          <SocialList>
            {[...sharers, ...silent].map((member, index) => {
              const figure = figureOf(member)
              const unavailable =
                member.yearStatus === "not_connected"
                  ? t("No year connected")
                  : member.yearStatus === "incompatible"
                    ? t("Year incompatible")
                    : t("Not shared")
              return (
                <SocialRow
                  key={member.membershipId}
                  leading={
                    figure?.average != null ? (
                      <span className="w-6 text-center text-sm font-semibold text-muted-foreground tabular-nums">
                        {index + 1}
                      </span>
                    ) : (
                      <span className="w-6" aria-hidden />
                    )
                  }
                  trailing={
                    <div className="flex items-center gap-2">
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
                          {unavailable}
                        </span>
                      )}
                      {isOwner && member.role !== "owner" && !frozen ? (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("Remove from class")}
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
              )
            })}
          </SocialList>
        </SocialSection>
      ) : null}

      {isOwner && template && !frozen ? (
        <SocialSection
          icon={LinkIcon}
          title={t("Invite classmates")}
          description={t(
            "The invitation shows the class model before the person chooses or creates a compatible year."
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
            <SecretLink url={inviteUrl} label={t("Class invitation link")} />
          ) : null}
          {invitations.data?.length ? (
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
              <Trash2Icon /> {t("Delete class")}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("Delete this class?")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t(
                    "The class and its memberships disappear for everyone. Nobody's years or grades are affected."
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => destroy.mutate({ groupId })}
                >
                  {t("Delete class")}
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
            <DoorOpenIcon /> {t("Leave class")}
          </Button>
        )}
        <ReportDialog groupId={groupId} />
        {isOwner ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CrownIcon className="size-3" aria-hidden />
            {t("You own this class.")}
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
