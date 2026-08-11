"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { EyeIcon, LockKeyholeIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { PageMeta } from "@/components/shell/page-chrome"
import { ProfilePreview } from "@/components/social/profile-preview"
import {
  PrivacyBoundaryNotice,
  SocialPageHeading,
} from "@/components/social/social-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

type ProfileField = "displayName" | "avatar" | "bio" | "educationBand"
type Audience = "friends" | "circle" | "specific_user"
type EducationBand =
  "unknown" | "middle_school" | "high_school" | "higher_education" | "other"

export function ProfileSharingClient() {
  const t = useExtracted()
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
  })
  const revokeGrant = useMutation({
    ...orpc.social.grants.revoke.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Sharing permission withdrawn immediately."))
      await refresh()
    },
  })

  const busy =
    updateProfile.isPending || addGrant.isPending || revokeGrant.isPending

  const targets = useMemo(() => {
    if (audience === "circle") {
      return (circles.data ?? []).map((circle) => ({
        id: circle.id,
        label: circle.name,
      }))
    }
    if (audience === "specific_user") {
      return (friends.data?.friends ?? []).map((friend) => ({
        id: friend.friendshipId,
        label: friend.profile?.displayName || t("Private friend"),
      }))
    }
    return []
  }, [audience, circles.data, friends.data?.friends, t])

  const previewTargets = useMemo(() => {
    if (previewAudience === "circle") {
      return (circles.data ?? []).map((circle) => ({
        id: circle.id,
        label: circle.name,
      }))
    }
    if (previewAudience === "specific_user") {
      return (friends.data?.friends ?? []).map((friend) => ({
        id: friend.friendshipId,
        label: friend.profile?.displayName || t("Private friend"),
      }))
    }
    return []
  }, [circles.data, friends.data?.friends, previewAudience, t])

  function fieldLabel(value: ProfileField) {
    if (value === "displayName") return t("Display name")
    if (value === "avatar") return t("Avatar")
    if (value === "bio") return t("Bio")
    return t("Education level")
  }

  function audienceLabel(value: Audience, targetId?: string | null) {
    if (value === "friends") return t("All friends")
    if (value === "circle") {
      return (
        circles.data?.find((circle) => circle.id === targetId)?.name ??
        t("Circle")
      )
    }
    return (
      friends.data?.friends.find((friend) => friend.friendshipId === targetId)
        ?.profile?.displayName ?? t("One friend")
    )
  }

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

  return (
    <>
      <PageMeta title={t("Profile & sharing")} backHref="/social" />
      <div className="flex flex-col gap-4">
        <SocialPageHeading
          title={t("Profile & sharing")}
          description={t(
            "Your source profile and its audiences are separate. No field is visible merely because someone is a friend or group member."
          )}
        />

        <div className="grid gap-4 @lg/main:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("Private source profile")}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t(
                  "Saving a field does not share it. Permissions are managed below."
                )}
              </p>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={saveProfile}>
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
                  <Label htmlFor="social-bio">{t("Bio")}</Label>
                  <Textarea
                    id="social-bio"
                    value={bio}
                    onChange={(event) => setBio(event.target.value)}
                    maxLength={280}
                    rows={4}
                  />
                  <p className="text-right text-xs text-muted-foreground">
                    {bio.length}/280
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="social-education">
                    {t("Education level")}
                  </Label>
                  <NativeSelect
                    id="social-education"
                    className="w-full"
                    value={educationBand}
                    onChange={(event) =>
                      setEducationBand(event.target.value as EducationBand)
                    }
                  >
                    <NativeSelectOption value="unknown">
                      {t("Not specified")}
                    </NativeSelectOption>
                    <NativeSelectOption value="middle_school">
                      {t("Middle school")}
                    </NativeSelectOption>
                    <NativeSelectOption value="high_school">
                      {t("High school")}
                    </NativeSelectOption>
                    <NativeSelectOption value="higher_education">
                      {t("Higher education")}
                    </NativeSelectOption>
                    <NativeSelectOption value="other">
                      {t("Other education")}
                    </NativeSelectOption>
                  </NativeSelect>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="social-discovery">{t("Discovery")}</Label>
                  <NativeSelect
                    id="social-discovery"
                    className="w-full"
                    value={discovery}
                    onChange={(event) =>
                      setDiscovery(event.target.value as typeof discovery)
                    }
                  >
                    <NativeSelectOption value="invite_only">
                      {t("Invite only")}
                    </NativeSelectOption>
                    <NativeSelectOption value="exact_handle">
                      {t("Exact handle only")}
                    </NativeSelectOption>
                  </NativeSelect>
                </div>
                {discovery === "exact_handle" ? (
                  <div className="space-y-2">
                    <Label htmlFor="social-handle">{t("Exact handle")}</Label>
                    <Input
                      id="social-handle"
                      value={handle}
                      onChange={(event) => setHandle(event.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={32}
                      placeholder="handle"
                    />
                  </div>
                ) : null}
                <Button
                  disabled={
                    busy ||
                    displayName.trim().length === 0 ||
                    (discovery === "exact_handle" &&
                      handle.trim().replace(/^@/, "").length < 3)
                  }
                >
                  {updateProfile.isPending ? <Spinner /> : null}
                  {t("Save profile")}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("Add a field permission")}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t("Absence of a permission always means refusal.")}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <form className="space-y-3" onSubmit={share}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="grant-field">{t("Profile field")}</Label>
                    <NativeSelect
                      id="grant-field"
                      className="w-full"
                      value={field}
                      onChange={(event) =>
                        setField(event.target.value as ProfileField)
                      }
                    >
                      <NativeSelectOption value="displayName">
                        {t("Display name")}
                      </NativeSelectOption>
                      <NativeSelectOption value="avatar">
                        {t("Avatar")}
                      </NativeSelectOption>
                      <NativeSelectOption value="bio">
                        {t("Bio")}
                      </NativeSelectOption>
                      <NativeSelectOption value="educationBand">
                        {t("Education level")}
                      </NativeSelectOption>
                    </NativeSelect>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="grant-audience">{t("Audience")}</Label>
                    <NativeSelect
                      id="grant-audience"
                      className="w-full"
                      value={audience}
                      onChange={(event) => {
                        setAudience(event.target.value as Audience)
                        setAudienceId("")
                      }}
                    >
                      <NativeSelectOption value="friends">
                        {t("All friends")}
                      </NativeSelectOption>
                      <NativeSelectOption value="circle">
                        {t("One circle")}
                      </NativeSelectOption>
                      <NativeSelectOption value="specific_user">
                        {t("One friend")}
                      </NativeSelectOption>
                    </NativeSelect>
                  </div>
                </div>
                {audience !== "friends" ? (
                  <div className="space-y-2">
                    <Label htmlFor="grant-target">{t("Choose audience")}</Label>
                    <NativeSelect
                      id="grant-target"
                      className="w-full"
                      value={audienceId}
                      onChange={(event) => setAudienceId(event.target.value)}
                    >
                      <NativeSelectOption value="">
                        {t("Choose…")}
                      </NativeSelectOption>
                      {targets.map((target) => (
                        <NativeSelectOption key={target.id} value={target.id}>
                          {target.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                ) : null}
                <Button
                  disabled={busy || (audience !== "friends" && !audienceId)}
                >
                  {addGrant.isPending ? <Spinner /> : <PlusIcon />}
                  {t("Grant this field")}
                </Button>
              </form>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">
                  {t("Active permissions")}
                </h3>
                {grants.data?.length ? (
                  <ul className="divide-y rounded-lg border">
                    {grants.data.map((grant) => (
                      <li
                        key={grant.id}
                        className="flex items-center gap-3 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {fieldLabel(grant.fieldKey)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {audienceLabel(grant.audience, grant.audienceId)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("Withdraw permission")}
                          disabled={busy}
                          onClick={() =>
                            revokeGrant.mutate({ grantId: grant.id })
                          }
                        >
                          <Trash2Icon />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Alert>
                    <LockKeyholeIcon aria-hidden />
                    <AlertTitle>{t("Nothing is shared")}</AlertTitle>
                    <AlertDescription>
                      {t(
                        "This is the private default until you add a permission."
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <EyeIcon className="size-4" /> {t("Exact viewer preview")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {t(
                "This server-calculated preview uses the same grants as the real viewer."
              )}
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 @lg/main:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="preview-audience">
                  {t("Preview audience")}
                </Label>
                <NativeSelect
                  id="preview-audience"
                  className="w-full"
                  value={previewAudience}
                  onChange={(event) => {
                    setPreviewAudience(event.target.value as Audience)
                    setPreviewAudienceId("")
                  }}
                >
                  <NativeSelectOption value="friends">
                    {t("All friends")}
                  </NativeSelectOption>
                  <NativeSelectOption value="circle">
                    {t("One circle")}
                  </NativeSelectOption>
                  <NativeSelectOption value="specific_user">
                    {t("One friend")}
                  </NativeSelectOption>
                </NativeSelect>
              </div>
              {previewAudience !== "friends" ? (
                <NativeSelect
                  aria-label={t("Preview target")}
                  className="w-full"
                  value={previewAudienceId}
                  onChange={(event) => setPreviewAudienceId(event.target.value)}
                >
                  <NativeSelectOption value="">
                    {t("Choose…")}
                  </NativeSelectOption>
                  {previewTargets.map((target) => (
                    <NativeSelectOption key={target.id} value={target.id}>
                      {target.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : null}
              <Badge variant="outline">{t("Server-calculated")}</Badge>
            </div>
            {preview.data ? (
              <ProfilePreview
                exact
                profile={preview.data}
                audienceLabel={t("Exactly what this audience can see")}
              />
            ) : (
              <div className="grid min-h-44 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">
                {preview.isFetching ? (
                  <Spinner />
                ) : (
                  t("Choose a viewer to preview.")
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <PrivacyBoundaryNotice />
      </div>
    </>
  )
}
