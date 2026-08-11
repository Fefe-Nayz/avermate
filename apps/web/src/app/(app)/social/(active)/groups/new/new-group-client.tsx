"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { GraduationCapIcon, ScrollTextIcon, UsersRoundIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  DEFAULT_POLICY_DRAFT,
  GroupPolicyEditor,
  type PolicyDraft,
} from "@/components/social/group-policy-editor"
import {
  ConsentCheck,
  PrivacyNote,
  SocialCallout,
  SocialHeading,
  SocialSection,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SelectControl } from "@/components/forms/controls"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

type GroupType = "friends" | "study_group" | "class"

/**
 * Creating a group is writing its policy.
 *
 * The owner is a member too, so the same consent step everyone else will face
 * is part of creation rather than an afterthought — an owner who has not read
 * their own policy is the likeliest source of an over-broad one.
 */
export function NewGroupClient() {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const years = useQuery(orpc.years.list.queryOptions())
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [type, setType] = useState<GroupType>("friends")
  const [classSelfDeclared, setClassSelfDeclared] = useState(false)
  const [alias, setAlias] = useState("")
  const [yearId, setYearId] = useState("")
  const [accepted, setAccepted] = useState(false)
  const [policy, setPolicy] = useState<PolicyDraft>(DEFAULT_POLICY_DRAFT)

  const create = useMutation({
    ...orpc.social.groups.create.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.key(),
      })
      router.push(`/social/groups/${result.group.id}`)
    },
    onError: () => toast.error(t("The group could not be created.")),
  })

  const availableYears = (years.data ?? []).filter((year) => !year.archivedAt)
  const valid =
    name.trim().length >= 2 &&
    alias.trim().length > 0 &&
    yearId.length > 0 &&
    policy.purpose.trim().length >= 10 &&
    policy.audienceDescription.trim().length >= 3 &&
    policy.fields.length > 0 &&
    accepted &&
    (type !== "class" || classSelfDeclared)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid) return
    create.mutate({
      name: name.trim(),
      description: description.trim(),
      type,
      classSelfDeclared: type === "class" && classSelfDeclared,
      alias: alias.trim(),
      sharedYearId: yearId,
      accepted: true,
      channel: "web",
      policy,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <SocialHeading
        icon={UsersRoundIcon}
        title={t("Create a private group")}
        description={t(
          "Write the purpose and the exact sharing rules before inviting anyone. Changing the policy later makes every member consent again."
        )}
      />

      <form className="flex flex-col gap-4" onSubmit={submit}>
        <SocialSection
          icon={UsersRoundIcon}
          title={t("Identity")}
          description={t("What invitees see before they decide.")}
        >
          <div className="grid gap-4 @lg/main:grid-cols-2">
            <div className="space-y-2 @lg/main:col-span-2">
              <Label htmlFor="new-group-name">{t("Group name")}</Label>
              <Input
                id="new-group-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-2 @lg/main:col-span-2">
              <Label htmlFor="new-group-description">{t("Description")}</Label>
              <Textarea
                id="new-group-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-group-type">{t("Group type")}</Label>
              <SelectControl
                id="new-group-type"
                value={type}
                onValueChange={(value) => {
                  setType(value as GroupType)
                  if (value !== "class") setClassSelfDeclared(false)
                }}
                options={[
                  { value: "friends", label: t("Friends group") },
                  { value: "study_group", label: t("Study group") },
                  { value: "class", label: t("Class group") },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-group-alias">{t("Your alias")}</Label>
              <Input
                id="new-group-alias"
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                maxLength={60}
                required
              />
              <p className="text-xs text-muted-foreground">
                {t("Members see this, never your email or profile handle.")}
              </p>
            </div>
            <div className="space-y-2 @lg/main:col-span-2">
              <Label htmlFor="new-group-year">
                {t("Academic year used for your figures")}
              </Label>
              <SelectControl
                id="new-group-year"
                value={yearId}
                onValueChange={setYearId}
                placeholder={t("Choose an academic year…")}
                options={availableYears.map((year) => ({
                  value: year.id,
                  label: year.name,
                }))}
              />
            </div>
          </div>

          {type === "class" ? (
            <ConsentCheck
              checked={classSelfDeclared}
              onCheckedChange={setClassSelfDeclared}
            >
              <span className="flex items-center gap-2 font-medium">
                <GraduationCapIcon className="size-4 shrink-0" aria-hidden />
                {t("I understand this is a self-declared class group.")}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {t(
                  "Avermate does not verify or endorse it as an official school, institution or class."
                )}
              </span>
            </ConsentCheck>
          ) : null}
        </SocialSection>

        <SocialSection
          icon={ScrollTextIcon}
          title={t("Version 1 of the sharing policy")}
          description={t("Everyone who joins answers exactly this document.")}
        >
          <GroupPolicyEditor
            value={policy}
            onChange={setPolicy}
            disabled={create.isPending}
          />
        </SocialSection>

        <SocialCallout tone="positive" title={t("Being owner grants nothing")}>
          {t(
            "The same policy, required figures, thresholds and withdrawal controls apply to you. Owners have no access to unshared academic data."
          )}
        </SocialCallout>

        <ConsentCheck checked={accepted} onCheckedChange={setAccepted}>
          {t(
            "I accept this policy for my own membership, and understand that optional ranking participation stays off until I choose it."
          )}
        </ConsentCheck>

        {create.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(
              "Review the group identity, policy and academic year, then try again."
            )}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={!valid || create.isPending}>
            {create.isPending ? <Spinner /> : null}
            {t("Create private group")}
          </Button>
        </div>
      </form>

      <PrivacyNote />
    </div>
  )
}
