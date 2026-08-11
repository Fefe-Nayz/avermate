"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  LinkIcon,
  PencilIcon,
  ScrollTextIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  GroupPolicyEditor,
  type PolicyDraft,
  type SocialMetric,
} from "@/components/social/group-policy-editor"
import { ReportDialog } from "@/components/social/report-dialog"
import { SecretLink } from "@/components/social/secret-link"
import {
  LinkState,
  SocialActions,
  SocialCallout,
  SocialEmpty,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { orpc } from "@/lib/orpc"

interface GroupManagementView {
  id: string
  name: string
  description: string
  revision: number
  role: "owner" | "moderator" | "member"
}

interface PolicyManagementView extends PolicyDraft {
  digest: string
  version: number
}

/**
 * Running the group.
 *
 * Publishing a policy version silently invalidates every member's consent, so
 * it is stated as a consequence next to the button rather than discovered in a
 * confirmation dialog. Leaving and deleting are grouped at the end, apart from
 * the everyday controls.
 */
export function GroupManagementPanel({
  group,
  policy,
}: {
  group: GroupManagementView
  policy: PolicyManagementView
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const manager = group.role === "owner" || group.role === "moderator"
  const invitations = useQuery({
    ...orpc.social.groups.invitations.list.queryOptions({
      input: { groupId: group.id },
    }),
    enabled: manager,
  })
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description)
  const [targetEmail, setTargetEmail] = useState("")
  const [freshLink, setFreshLink] = useState<string | null>(null)
  const [draft, setDraft] = useState<PolicyDraft>({
    purpose: policy.purpose,
    audienceDescription: policy.audienceDescription,
    window: policy.window,
    rankingsEnabled: policy.rankingsEnabled,
    fields: policy.fields.map((field) => ({
      ...field,
      fieldKey: field.fieldKey as SocialMetric,
    })),
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.key(),
      }),
      queryClient.invalidateQueries({ queryKey: orpc.social.groups.get.key() }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.policy.current.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.invitations.list.key(),
      }),
    ])
  }
  const update = useMutation({
    ...orpc.social.groups.update.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Group saved."))
      await refresh()
    },
  })
  const newPolicy = useMutation({
    ...orpc.social.groups.policy.createVersion.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("New policy published. Every member must consent again."))
      await refresh()
    },
  })
  const createInvitation = useMutation({
    ...orpc.social.groups.invitations.create.mutationOptions(),
    onSuccess: async (result) => {
      setFreshLink(new URL(result.sharePath, window.location.origin).toString())
      setTargetEmail("")
      await refresh()
    },
  })
  const revokeInvitation = useMutation({
    ...orpc.social.groups.invitations.revoke.mutationOptions(),
    onSuccess: refresh,
  })
  const archive = useMutation({
    ...orpc.social.groups.archive.mutationOptions(),
    onSuccess: async () => {
      await refresh()
      router.push("/social/groups")
    },
  })
  const deleteGroup = useMutation({
    ...orpc.social.groups.delete.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.key(),
      })
      router.push("/social/groups")
    },
  })
  const leave = useMutation({
    ...orpc.social.groups.members.leave.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.key(),
      })
      router.push("/social/groups")
    },
  })
  const busy =
    update.isPending ||
    newPolicy.isPending ||
    createInvitation.isPending ||
    revokeInvitation.isPending ||
    archive.isPending ||
    deleteGroup.isPending ||
    leave.isPending

  const policyReady =
    draft.purpose.trim().length >= 10 &&
    draft.audienceDescription.trim().length >= 3 &&
    draft.fields.length > 0

  return (
    <div className="flex flex-col gap-4">
      {manager ? (
        <SocialSection
          icon={LinkIcon}
          title={t("Invitations")}
          description={t(
            "One-time, expiring, and locked to the current policy version. An optional recipient address is hashed and never shown again."
          )}
        >
          <div className="grid gap-2 @lg/main:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              type="email"
              value={targetEmail}
              onChange={(event) => setTargetEmail(event.target.value)}
              placeholder={t("Optional recipient email")}
              aria-label={t("Optional recipient email")}
            />
            <Button
              disabled={busy}
              onClick={() =>
                createInvitation.mutate({
                  groupId: group.id,
                  targetEmail: targetEmail.trim().toLowerCase() || null,
                  expiresInDays: 7,
                })
              }
            >
              {createInvitation.isPending ? <Spinner /> : <LinkIcon />}
              {t("Create 7-day link")}
            </Button>
          </div>

          {freshLink ? (
            <SecretLink url={freshLink} label={t("Your new invitation link")} />
          ) : null}

          {invitations.data?.length ? (
            <SocialList>
              {invitations.data.map((invitation) => {
                const active = !invitation.consumedAt && !invitation.revokedAt
                return (
                  <SocialRow
                    key={invitation.id}
                    trailing={
                      <>
                        <LinkState
                          consumed={invitation.consumedAt}
                          revoked={invitation.revokedAt}
                        />
                        {active ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              revokeInvitation.mutate({
                                groupId: group.id,
                                invitationId: invitation.id,
                              })
                            }
                          >
                            {t("Revoke")}
                          </Button>
                        ) : null}
                      </>
                    }
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm">
                        {t("Policy version {version}", {
                          version: String(invitation.policyVersion),
                        })}
                      </span>
                      {invitation.targeted ? (
                        <Badge variant="outline">
                          {t("Account-targeted")}
                        </Badge>
                      ) : null}
                    </div>
                  </SocialRow>
                )
              })}
            </SocialList>
          ) : (
            <SocialEmpty
              compact
              icon={LinkIcon}
              title={t("No invitations yet")}
              description={t(
                "A link is the only way in — this group is never discoverable."
              )}
            />
          )}
        </SocialSection>
      ) : null}

      {group.role === "owner" ? (
        <>
          <SocialSection
            icon={PencilIcon}
            title={t("Group identity")}
            description={t("Visible to members and to anyone you invite.")}
            footer={
              <Button
                variant="outline"
                disabled={busy || name.trim().length < 2}
                onClick={() =>
                  update.mutate({
                    groupId: group.id,
                    name: name.trim(),
                    description: description.trim(),
                    expectedRevision: group.revision,
                  })
                }
              >
                {update.isPending ? <Spinner /> : null}
                {t("Save group")}
              </Button>
            }
          >
            <div className="space-y-2">
              <Label htmlFor="manage-group-name">{t("Name")}</Label>
              <Input
                id="manage-group-name"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manage-group-description">
                {t("Description")}
              </Label>
              <Textarea
                id="manage-group-description"
                value={description}
                maxLength={500}
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </SocialSection>

          <SocialSection
            icon={ScrollTextIcon}
            title={t("Publish a new policy version")}
            description={t("Currently on version {version}.", {
              version: String(policy.version),
            })}
            footer={
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button disabled={busy || !policyReady} />}
                >
                  {newPolicy.isPending ? <Spinner /> : null}
                  {t("Publish and require reconsent")}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("Publish this new policy?")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t(
                        "All current consents and ranking opt-ins stop applying. Members must make fresh choices before content becomes visible again."
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        newPolicy.mutate({
                          groupId: group.id,
                          expectedRevision: group.revision,
                          policy: draft,
                        })
                      }
                    >
                      {t("Publish new version")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            }
          >
            <SocialCallout
              tone="caution"
              title={t("Publishing pauses the whole group")}
            >
              {t(
                "Member details, statistics and rankings disappear for everyone until each person reviews and accepts the new version."
              )}
            </SocialCallout>
            <GroupPolicyEditor
              value={draft}
              onChange={setDraft}
              disabled={busy}
            />
          </SocialSection>
        </>
      ) : null}

      <SocialSection
        icon={TriangleAlertIcon}
        title={t("Safety and membership")}
        description={t("Reports reach Avermate moderators, not the group.")}
      >
        <SocialActions>
          <ReportDialog source="group" sourceId={group.id} />
          {group.role === "owner" ? (
            <>
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button variant="outline" disabled={busy} />}
                >
                  {t("Archive group")}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("Archive this group?")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("It leaves active lists and stops normal participation.")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        archive.mutate({
                          groupId: group.id,
                          archived: true,
                          expectedRevision: group.revision,
                        })
                      }
                    >
                      {t("Archive")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      className="text-destructive"
                      disabled={busy}
                    />
                  }
                >
                  {t("Delete group")}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("Delete this group permanently?")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t(
                        "Memberships, policies, invitations and group comparisons are removed."
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() =>
                        deleteGroup.mutate({
                          groupId: group.id,
                          expectedRevision: group.revision,
                        })
                      }
                    >
                      {t("Delete permanently")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy}
                  />
                }
              >
                {t("Leave group")}
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("Leave this group?")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(
                      "Your membership and future contribution to group results end immediately."
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => leave.mutate({ groupId: group.id })}
                  >
                    {t("Leave group")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </SocialActions>
      </SocialSection>
    </div>
  )
}
