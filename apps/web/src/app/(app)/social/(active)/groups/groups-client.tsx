"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CrownIcon, PlusIcon, SnowflakeIcon, UsersRoundIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  SocialEmpty,
  SocialHeading,
  SocialList,
  SocialRow,
  SocialSection,
} from "@/components/social/social-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

/**
 * Groups: rooms whose members compare general averages. Creating one asks
 * for a name and nothing else — the policy documents, consent versions and
 * member thresholds are gone.
 */
export function GroupsClient() {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const groups = useQuery(orpc.social.groups.list.queryOptions())
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  const create = useMutation({
    ...orpc.social.groups.create.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      setOpen(false)
      setName("")
      setDescription("")
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.key(),
      })
      router.push(`/social/groups/${result.id}`)
    },
    onError: () => toast.error(t("The group could not be created.")),
  })

  return (
    <div className="flex flex-col gap-4">
      <SocialHeading
        icon={UsersRoundIcon}
        title={t("Groups")}
        description={t(
          "Compare general averages with a class or a group of friends. Each member decides whether their own figure appears."
        )}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button type="button" />}>
              <PlusIcon /> {t("New group")}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("Create a group")}</DialogTitle>
                <DialogDescription>
                  {t("Give it a name, then share the invitation link.")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div className="space-y-2">
                  <Label htmlFor="new-group-name">{t("Group name")}</Label>
                  <Input
                    id="new-group-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={100}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-group-description">
                    {t("Description (optional)")}
                  </Label>
                  <Textarea
                    id="new-group-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={500}
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  disabled={create.isPending || name.trim().length < 2}
                  onClick={() =>
                    create.mutate({
                      name: name.trim(),
                      description: description.trim(),
                    })
                  }
                >
                  {create.isPending ? <Spinner /> : null}
                  {t("Create group")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <SocialSection icon={UsersRoundIcon} title={t("Your groups")}>
        {groups.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : groups.data?.length ? (
          <SocialList>
            {groups.data.map((group) => (
              <SocialRow
                key={group.id}
                href={`/social/groups/${group.id}`}
                trailing={
                  <div className="flex items-center gap-2">
                    {group.state === "frozen" ? (
                      <Badge variant="outline" className="gap-1">
                        <SnowflakeIcon className="size-3" aria-hidden />
                        {t("On hold")}
                      </Badge>
                    ) : null}
                    {group.role === "owner" ? (
                      <Badge variant="secondary" className="gap-1">
                        <CrownIcon className="size-3" aria-hidden />
                        {t("Owner")}
                      </Badge>
                    ) : null}
                  </div>
                }
              >
                <p className="truncate text-sm font-medium">{group.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {group.memberCount === 1
                    ? t("1 member")
                    : t("{count} members", { count: String(group.memberCount) })}
                  {group.description ? ` · ${group.description}` : ""}
                </p>
              </SocialRow>
            ))}
          </SocialList>
        ) : (
          <SocialEmpty
            compact
            icon={UsersRoundIcon}
            title={t("No groups yet")}
            description={t(
              "Create one and send the link, or open an invitation someone sent you."
            )}
          />
        )}
      </SocialSection>
    </div>
  )
}
