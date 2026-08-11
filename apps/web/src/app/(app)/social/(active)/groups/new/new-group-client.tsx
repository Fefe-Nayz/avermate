"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ShieldCheckIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  DEFAULT_POLICY_DRAFT,
  GroupPolicyEditor,
  type PolicyDraft,
} from "@/components/social/group-policy-editor"
import {
  PrivacyBoundaryNotice,
  SocialPageHeading,
} from "@/components/social/social-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

type GroupType = "friends" | "study_group" | "class"

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
      <SocialPageHeading
        title={t("Create a private group")}
        description={t(
          "Define the purpose and exact sharing rules before inviting anyone. Changing the policy later requires every member to consent again."
        )}
      />

      <form className="space-y-4" onSubmit={submit}>
        <Card>
          <CardHeader>
            <CardTitle>{t("Group identity")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="new-group-name">{t("Group name")}</Label>
              <Input
                id="new-group-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
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
              <NativeSelect
                id="new-group-type"
                className="w-full"
                value={type}
                onChange={(event) => {
                  setType(event.target.value as GroupType)
                  if (event.target.value !== "class")
                    setClassSelfDeclared(false)
                }}
              >
                <NativeSelectOption value="friends">
                  {t("Friends group")}
                </NativeSelectOption>
                <NativeSelectOption value="study_group">
                  {t("Study group")}
                </NativeSelectOption>
                <NativeSelectOption value="class">
                  {t("Class group")}
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-group-alias">{t("Your group alias")}</Label>
              <Input
                id="new-group-alias"
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                maxLength={60}
                required
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  "Members see this alias, not your account email or profile handle."
                )}
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="new-group-year">
                {t("Academic year used for your metrics")}
              </Label>
              <NativeSelect
                id="new-group-year"
                className="w-full"
                value={yearId}
                onChange={(event) => setYearId(event.target.value)}
                required
              >
                <NativeSelectOption value="">
                  {t("Choose an academic year…")}
                </NativeSelectOption>
                {availableYears.map((year) => (
                  <NativeSelectOption key={year.id} value={year.id}>
                    {year.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            {type === "class" ? (
              <label className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:col-span-2">
                <Checkbox
                  checked={classSelfDeclared}
                  onCheckedChange={(checked) =>
                    setClassSelfDeclared(checked === true)
                  }
                />
                <span>
                  <span className="block text-sm font-medium">
                    {t("I understand this is a self-declared class group.")}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {t(
                      "Avermate does not verify or endorse it as an official school, institution or class."
                    )}
                  </span>
                </span>
              </label>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Version 1 sharing policy")}</CardTitle>
          </CardHeader>
          <CardContent>
            <GroupPolicyEditor
              value={policy}
              onChange={setPolicy}
              disabled={create.isPending}
            />
          </CardContent>
        </Card>

        <Alert>
          <ShieldCheckIcon aria-hidden />
          <AlertTitle>{t("Owner consent")}</AlertTitle>
          <AlertDescription>
            {t(
              "Owners have no special access to unshared academic data. The same policy, required fields, thresholds and withdrawal controls apply to you."
            )}
          </AlertDescription>
        </Alert>

        <label className="flex items-start gap-3 rounded-xl border p-4">
          <Checkbox
            checked={accepted}
            onCheckedChange={(checked) => setAccepted(checked === true)}
          />
          <span className="text-sm leading-relaxed">
            {t(
              "I accept this exact policy for my own membership and understand that optional ranking participation remains off."
            )}
          </span>
        </label>

        {create.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(
              "Review the group identity, policy and academic year, then try again."
            )}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button disabled={!valid || create.isPending}>
            {create.isPending ? <Spinner /> : null}
            {t("Create private group")}
          </Button>
        </div>
      </form>

      <PrivacyBoundaryNotice />
    </div>
  )
}
