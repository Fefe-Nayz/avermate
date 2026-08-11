"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  EyeIcon,
  LayersIcon,
  LockKeyholeIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { PageMeta } from "@/components/shell/page-chrome"
import { ProfilePreview } from "@/components/social/profile-preview"
import {
  PrivacyNote,
  SharingState,
  SocialCallout,
  SocialEmpty,
  SocialHeading,
  SocialList,
  SocialRow,
  SocialSection,
  useSocialLabels,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SelectControl } from "@/components/forms/controls"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { SOCIAL_PROFILE_FIELDS } from "@/lib/social-presentation"

type ProfileField = "displayName" | "avatar" | "bio" | "educationBand"
type Audience = "friends" | "circle" | "specific_user"
type EducationBand =
  | "unknown"
  | "middle_school"
  | "high_school"
  | "higher_education"
  | "other"

/**
 * Profile and sharing.
 *
 * The old screen listed permissions as a flat run of "Bio → One circle" rows,
 * which answers the question nobody asks. People ask *what does this person
 * see* — so grants are grouped by audience, and each group shows the withheld
 * fields alongside the granted ones. An audience that receives two of four
 * fields should look like a decision, not like a short list.
 */
export function ProfileSharingClient() {
  const t = useExtracted()
  const labels = useSocialLabels()
  const queryClient = useQueryClient()
  const mine = useQuery(orpc.social.profile.mine.queryOptions())
  const grants = useQuery(orpc.social.grants.list.queryOptions())
  const friends = useQuery(orpc.social.friends.list.queryOptions())
  const circles = useQuery(orpc.social.circles.list.queryOptions())
  const profile = mine.data?.profile

  const [displayName, setDisplayName] = useState(profile?.displayName ?? "")
  const [bio, setBio] = useState(profile?.bio ?? "")
  const [educationBand, setEducationBand] = useState<EducationBand>(
    profile?.educationBand ?? "unknown"
  )
  const [discovery, setDiscovery] = useState<"invite_only" | "exact_handle">(
    profile?.discovery === "exact_handle" ? "exact_handle" : "invite_only"
  )
  const [handle, setHandle] = useState(profile?.handle ?? "")

  const [field, setField] = useState<ProfileField>("displayName")
  const [audience, setAudience] = useState<Audience>("friends")
  const [audienceId, setAudienceId] = useState("")
  const [previewAudience, setPreviewAudience] = useState<Audience>("friends")
  const [previewAudienceId, setPreviewAudienceId] = useState("")

  const preview = useQuery({
    ...orpc.social.profile.previewMineAs.queryOptions({
      input: {
        audience: previewAudience,
        audienceId:
          previewAudience === "friends" ? null : previewAudienceId || null,
      },
    }),
    enabled: previewAudience === "friends" || previewAudienceId.length > 0,
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.profile.mine.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.grants.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.profile.previewMineAs.key(),
      }),
    ])
  }

  const updateProfile = useMutation({
    ...orpc.social.profile.update.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Social profile saved."))
      await refresh()
    },
    onError: () => toast.error(t("The social profile could not be saved.")),
  })
  const addGrant = useMutation({
    ...orpc.social.grants.upsert.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Sharing permission updated."))
      await refresh()
    },
    onError: () =>
      toast.error(t("The request could not be processed. Try again later.")),
  })
  const revokeGrant = useMutation({
    ...orpc.social.grants.revoke.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Sharing permission withdrawn immediately."))
      await refresh()
    },
    onError: () =>
      toast.error(t("The request could not be processed. Try again later.")),
  })

  const busy =
    updateProfile.isPending || addGrant.isPending || revokeGrant.isPending

  function targetsFor(kind: Audience) {
    if (kind === "circle") {
      return (circles.data ?? []).map((circle) => ({
        id: circle.id,
        label: circle.name,
      }))
    }
    if (kind === "specific_user") {
      return (friends.data?.friends ?? []).map((friend) => ({
        id: friend.friendshipId,
        label: friend.profile?.displayName || t("Private friend"),
      }))
    }
    return []
  }

  function audienceLabel(value: Audience, targetId?: string | null) {
    if (value === "friends") return t("All friends")
    if (value === "circle") {
      return (
        circles.data?.find((circle) => circle.id === targetId)?.name ??
        t("A circle")
      )
    }
    return (
      friends.data?.friends.find((friend) => friend.friendshipId === targetId)
        ?.profile?.displayName ?? t("One friend")
    )
  }

  /** One entry per audience, not one per permission. */
  const audiences = useMemo(() => {
    const byAudience = new Map<
      string,
      {
        key: string
        audience: Audience
        audienceId: string | null
        grants: Array<{ id: string; fieldKey: ProfileField }>
      }
    >()
    for (const grant of grants.data ?? []) {
      const key = `${grant.audience}:${grant.audienceId ?? ""}`
      const entry = byAudience.get(key) ?? {
        key,
        audience: grant.audience as Audience,
        audienceId: grant.audienceId ?? null,
        grants: [],
      }
      entry.grants.push({ id: grant.id, fieldKey: grant.fieldKey })
      byAudience.set(key, entry)
    }
    return [...byAudience.values()].sort((a, b) =>
      a.audience === "friends" ? -1 : b.audience === "friends" ? 1 : 0
    )
  }, [grants.data])

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) return
    updateProfile.mutate({
      displayName: displayName.trim(),
      bio: bio.trim(),
      educationBand,
      discovery,
      handle:
        discovery === "exact_handle" ? handle.trim().replace(/^@/, "") : null,
      expectedRevision: profile.revision,
    })
  }

  function share(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (audience !== "friends" && !audienceId) return
    addGrant.mutate({
      fieldKey: field,
      audience,
      audienceId: audience === "friends" ? null : audienceId,
    })
  }

  if (!profile) return null

  const grantTargets = targetsFor(audience)
  const previewTargets = targetsFor(previewAudience)
  const findable = discovery === "exact_handle"

  return (
    <>
      <PageMeta title={t("Profile & sharing")} backHref="/social" />
      <div className="flex flex-col gap-4">
        <SocialHeading
          icon={SlidersHorizontalIcon}
          title={t("Profile and sharing")}
          description={t(
            "What you write and who receives it are two separate decisions. Nothing here is visible because someone is a friend — only because you granted it."
          )}
        />

        <div className="grid gap-4 @4xl/main:grid-cols-[minmax(0,1fr)_22rem] @4xl/main:items-start">
          <div className="flex flex-col gap-4">
            <SocialSection
              icon={UserRoundIcon}
              title={t("Your profile")}
              description={t("Saving a field does not share it.")}
            >
              <form className="flex flex-col gap-4" onSubmit={saveProfile}>
                <div className="grid gap-4 @lg/main:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="social-display-name">
                      {t("Display name")}
                    </Label>
                    <Input
                      id="social-display-name"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      maxLength={80}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="social-education">
                      {t("Education level")}
                    </Label>
                    <SelectControl
                      id="social-education"
                      value={educationBand}
                      onValueChange={(value) =>
                        setEducationBand(value as EducationBand)
                      }
                      options={[
                        { value: "unknown", label: t("Not specified") },
                        { value: "middle_school", label: t("Middle school") },
                        { value: "high_school", label: t("High school") },
                        {
                          value: "higher_education",
                          label: t("Higher education"),
                        },
                        { value: "other", label: t("Other education") },
                      ]}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-bio">{t("Bio")}</Label>
                  <Textarea
                    id="social-bio"
                    value={bio}
                    onChange={(event) => setBio(event.target.value)}
                    maxLength={280}
                    rows={3}
                  />
                  <p className="numeric text-right text-xs text-muted-foreground">
                    {bio.length}/280
                  </p>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t("How you can be found")}</p>
                    <SharingState
                      granted={findable}
                      label={findable ? t("Exact handle") : t("Invite only")}
                    />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {findable
                      ? t(
                          "Someone who types your exact handle can send a request. You are never listed on the open web."
                        )
                      : t(
                          "Only people you send a one-time invitation link to can reach your profile."
                        )}
                  </p>
                  <div className="mt-3 grid gap-3 @lg/main:grid-cols-2">
                    <SelectControl
                      aria-label={t("Discovery")}
                      value={discovery}
                      onValueChange={(value) =>
                        setDiscovery(value as typeof discovery)
                      }
                      options={[
                        { value: "invite_only", label: t("Invite only") },
                        { value: "exact_handle", label: t("Exact handle only") },
                      ]}
                    />
                    {findable ? (
                      <Input
                        value={handle}
                        onChange={(event) => setHandle(event.target.value)}
                        aria-label={t("Exact handle")}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        maxLength={32}
                        placeholder={t("your-handle")}
                      />
                    ) : null}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={
                      busy ||
                      displayName.trim().length === 0 ||
                      (findable &&
                        handle.trim().replace(/^@/, "").length < 3)
                    }
                  >
                    {updateProfile.isPending ? <Spinner /> : null}
                    {t("Save profile")}
                  </Button>
                </div>
              </form>
            </SocialSection>

            <SocialSection
              icon={UsersRoundIcon}
              title={t("Who sees what")}
              description={t(
                "One block per audience. A field that is not listed as shared is refused."
              )}
              footer={
                <form className="flex w-full flex-wrap gap-2" onSubmit={share}>
                  <SelectControl
                    aria-label={t("Profile field")}
                    value={field}
                    onValueChange={(value) => setField(value as ProfileField)}
                    className="min-w-36 flex-1"
                    options={SOCIAL_PROFILE_FIELDS.map((key) => ({
                      value: key,
                      label: labels.profileField(key),
                    }))}
                  />
                  <SelectControl
                    aria-label={t("Audience")}
                    value={audience}
                    onValueChange={(value) => {
                      setAudience(value as Audience)
                      setAudienceId("")
                    }}
                    className="min-w-36 flex-1"
                    options={[
                      { value: "friends", label: t("All friends") },
                      { value: "circle", label: t("One circle") },
                      { value: "specific_user", label: t("One friend") },
                    ]}
                  />
                  {audience !== "friends" ? (
                    <SelectControl
                      aria-label={t("Choose audience")}
                      value={audienceId}
                      onValueChange={setAudienceId}
                      placeholder={t("Choose…")}
                      className="min-w-36 flex-1"
                      options={grantTargets.map((target) => ({
                        value: target.id,
                        label: target.label,
                      }))}
                    />
                  ) : null}
                  <Button
                    type="submit"
                    disabled={busy || (audience !== "friends" && !audienceId)}
                  >
                    {addGrant.isPending ? <Spinner /> : <PlusIcon />}
                    {t("Grant")}
                  </Button>
                </form>
              }
            >
              {audiences.length ? (
                audiences.map((entry) => {
                  const granted = new Map(
                    entry.grants.map((grant) => [grant.fieldKey, grant.id])
                  )
                  const withheld = SOCIAL_PROFILE_FIELDS.filter(
                    (key) => !granted.has(key)
                  )
                  return (
                    <div
                      key={entry.key}
                      className="overflow-hidden rounded-xl border"
                    >
                      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                        {entry.audience === "circle" ? (
                          <LayersIcon
                            className="size-3.5 text-muted-foreground"
                            aria-hidden
                          />
                        ) : entry.audience === "specific_user" ? (
                          <UserRoundIcon
                            className="size-3.5 text-muted-foreground"
                            aria-hidden
                          />
                        ) : (
                          <UsersRoundIcon
                            className="size-3.5 text-muted-foreground"
                            aria-hidden
                          />
                        )}
                        <p className="min-w-0 flex-1 truncate text-sm font-medium">
                          {audienceLabel(entry.audience, entry.audienceId)}
                        </p>
                      </div>
                      <div className="px-3">
                        <SocialList>
                          {[...granted].map(([fieldKey, grantId]) => (
                            <SocialRow
                              key={grantId}
                              trailing={
                                <>
                                  <SharingState granted />
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={t("Withdraw permission")}
                                    disabled={busy}
                                    onClick={() =>
                                      revokeGrant.mutate({ grantId })
                                    }
                                  >
                                    <Trash2Icon />
                                  </Button>
                                </>
                              }
                            >
                              <p className="text-sm">
                                {labels.profileField(fieldKey)}
                              </p>
                            </SocialRow>
                          ))}
                        </SocialList>
                      </div>
                      {withheld.length ? (
                        <p className="flex items-start gap-1.5 border-t px-3 py-2 text-xs text-muted-foreground">
                          <LockKeyholeIcon
                            className="mt-px size-3 shrink-0"
                            aria-hidden
                          />
                          {t("Withheld: {fields}", {
                            fields: withheld
                              .map((key) => labels.profileField(key))
                              .join(", "),
                          })}
                        </p>
                      ) : null}
                    </div>
                  )
                })
              ) : (
                <SocialEmpty
                  compact
                  icon={LockKeyholeIcon}
                  title={t("Nothing is shared")}
                  description={t(
                    "This is the default. Grant a field below to change it for one audience at a time."
                  )}
                />
              )}
            </SocialSection>
          </div>

          <div className="flex flex-col gap-4 @4xl/main:sticky @4xl/main:top-4">
            <SocialSection
              icon={EyeIcon}
              title={t("Seen from outside")}
              description={t(
                "Calculated by the server with the same rules a real viewer gets."
              )}
            >
              <div className="grid gap-2 @lg/main:grid-cols-2 @4xl/main:grid-cols-1">
                <SelectControl
                  aria-label={t("Preview audience")}
                  value={previewAudience}
                  onValueChange={(value) => {
                    setPreviewAudience(value as Audience)
                    setPreviewAudienceId("")
                  }}
                  options={[
                    { value: "friends", label: t("All friends") },
                    { value: "circle", label: t("One circle") },
                    { value: "specific_user", label: t("One friend") },
                  ]}
                />
                {previewAudience !== "friends" ? (
                  <SelectControl
                    aria-label={t("Preview target")}
                    value={previewAudienceId}
                    onValueChange={setPreviewAudienceId}
                    placeholder={t("Choose…")}
                    options={previewTargets.map((target) => ({
                      value: target.id,
                      label: target.label,
                    }))}
                  />
                ) : null}
              </div>

              {preview.data ? (
                <ProfilePreview
                  exact
                  profile={preview.data}
                  audienceLabel={audienceLabel(
                    previewAudience,
                    previewAudienceId
                  )}
                />
              ) : (
                <div className="grid min-h-40 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">
                  {preview.isFetching ? <Spinner /> : t("Choose a viewer.")}
                </div>
              )}
            </SocialSection>

            <SocialCallout
              tone="positive"
              title={t("Withdrawal is immediate")}
            >
              {t(
                "Removing a permission takes effect on the next request. Nothing is cached on anyone else's account."
              )}
            </SocialCallout>
          </div>
        </div>

        <PrivacyNote />
      </div>
    </>
  )
}
