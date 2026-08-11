"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckIcon, CopyIcon, LinkIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  GroupPolicyEditor,
  type PolicyDraft,
  type SocialMetric,
} from "@/components/social/group-policy-editor"
import { ReportDialog } from "@/components/social/report-dialog"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  const [copied, setCopied] = useState(false)
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
    onSuccess: refresh,
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
      setCopied(false)
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

  async function copyLink() {
    if (!freshLink) return
    await navigator.clipboard.writeText(freshLink)
    setCopied(true)
  }

  return (
    <section className="space-y-4" aria-labelledby="group-management-heading">
      <h2 id="group-management-heading" className="text-lg font-semibold">
        {t("Group controls")}
      </h2>

      {manager ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("Private invitations")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t(
                "Invitations are one-time, expire, and are locked to this policy version. An optional target email is hashed and never shown in the list."
              )}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
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
              <div className="space-y-2 rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">
                  {t(
                    "Copy this secret now; the full token is not stored for later display."
                  )}
                </p>
                <div className="flex gap-2">
                  <Input
                    value={freshLink}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button variant="outline" size="icon" onClick={copyLink}>
                    {copied ? <CheckIcon /> : <CopyIcon />}
                    <span className="sr-only">{t("Copy link")}</span>
                  </Button>
                </div>
              </div>
            ) : null}
            {invitations.data?.length ? (
              <ul className="divide-y rounded-xl border">
                {invitations.data.map((invitation) => {
                  const active = !invitation.consumedAt && !invitation.revokedAt
                  return (
                    <li
                      key={invitation.id}
                      className="flex items-center justify-between gap-2 p-3"
                    >
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={active ? "secondary" : "outline"}>
                          {invitation.consumedAt
                            ? t("Used")
                            : invitation.revokedAt
                              ? t("Revoked")
                              : t("Active")}
                        </Badge>
                        {invitation.targeted ? (
                          <Badge variant="outline">
                            {t("Account-targeted")}
                          </Badge>
                        ) : null}
                        <Badge variant="outline">
                          {t("Policy version {version}", {
                            version: String(invitation.policyVersion),
                          })}
                        </Badge>
                      </div>
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
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {group.role === "owner" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("Group identity")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("Publish a new policy version")}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t(
                  "Publishing immediately hides member details, aggregates and rankings until each person reviews and accepts the new version."
                )}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <GroupPolicyEditor
                value={draft}
                onChange={setDraft}
                disabled={busy}
              />
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      disabled={
                        busy ||
                        draft.purpose.trim().length < 10 ||
                        draft.audienceDescription.trim().length < 3 ||
                        draft.fields.length === 0
                      }
                    />
                  }
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
            </CardContent>
          </Card>
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("Safety & membership")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
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
                      {t(
                        "It leaves active lists and stops normal participation."
                      )}
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
                  render={<Button variant="destructive" disabled={busy} />}
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
                render={<Button variant="destructive" disabled={busy} />}
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
        </CardContent>
      </Card>
    </section>
  )
}
