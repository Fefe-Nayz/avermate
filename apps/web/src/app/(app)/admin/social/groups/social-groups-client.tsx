"use client"

import Link from "next/link"
import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { SearchIcon, ShieldAlertIcon, SnowflakeIcon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { PageMeta } from "@/components/shell/page-chrome"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { INITIAL_ADMIN_SOCIAL_GROUPS_INPUT } from "@/lib/admin-social-inputs"
import { orpc } from "@/lib/orpc"

type GroupState = "active" | "frozen" | "archived" | "all"
type GroupType = "friends" | "study_group" | "class" | "all"
type GroupFilters = {
  state: GroupState
  type: GroupType
  search: string
  limit: number
  offset: number
}
type PendingModeration = {
  id: string
  name: string
  revision: number
  frozen: boolean
}

function stateLabel(
  state: Exclude<GroupState, "all">,
  t: ReturnType<typeof useExtracted>
) {
  if (state === "active") return t("Active")
  if (state === "frozen") return t("Frozen")
  return t("Archived")
}

export function AdminSocialGroupsClient() {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<GroupFilters>({
    ...INITIAL_ADMIN_SOCIAL_GROUPS_INPUT,
  })
  const [search, setSearch] = useState("")
  const [pending, setPending] = useState<PendingModeration | null>(null)
  const [reason, setReason] = useState("")

  const groups = useQuery(
    orpc.admin.socialGroups.queryOptions({ input: filters })
  )
  const moderate = useMutation({
    ...orpc.admin.freezeSocialGroup.mutationOptions(),
    onSuccess: async () => {
      setPending(null)
      setReason("")
      toast.success(t("The group's safety state was updated."))
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.admin.socialGroups.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.admin.socialOverview.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.admin.socialAudit.key(),
        }),
      ])
    },
    onError: async () => {
      toast.error(t("The group changed elsewhere. The list was reloaded."))
      await queryClient.invalidateQueries({
        queryKey: orpc.admin.socialGroups.key(),
      })
    },
  })

  function updateFilters(patch: Partial<GroupFilters>) {
    setFilters((current) => ({
      ...current,
      ...patch,
      offset: patch.offset ?? 0,
    }))
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    updateFilters({ search: search.trim() })
  }

  const hasNext = Boolean(
    groups.data && groups.data.offset + groups.data.limit < groups.data.total
  )

  return (
    <>
      <PageMeta
        title={t("Social groups moderation")}
        backHref="/admin/social"
      />
      <div className="flex flex-col gap-4">
        <div className="hidden md:block">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Groups and self-declared classes")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Moderate group access and safety without viewing grades or overriding sharing consent."
            )}
          </p>
        </div>

        <Alert>
          <ShieldAlertIcon aria-hidden />
          <AlertTitle>{t("Consent remains authoritative")}</AlertTitle>
          <AlertDescription>
            {t(
              "Freezing a group withdraws current sharing consent, disables rankings, revokes pending invitations and clears aggregates. Unfreezing never restores consent automatically."
            )}
          </AlertDescription>
        </Alert>

        <Card className="py-4">
          <CardContent className="space-y-3 px-4">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={submitSearch}
            >
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("Search by group name")}
                aria-label={t("Search social groups")}
              />
              <Button variant="outline" type="submit">
                <SearchIcon aria-hidden />
                {t("Search")}
              </Button>
            </form>
            <div className="grid gap-2 sm:grid-cols-2">
              <NativeSelect
                className="w-full"
                aria-label={t("Group state filter")}
                value={filters.state}
                onChange={(event) =>
                  updateFilters({ state: event.target.value as GroupState })
                }
              >
                <NativeSelectOption value="all">
                  {t("All states")}
                </NativeSelectOption>
                <NativeSelectOption value="active">
                  {t("Active")}
                </NativeSelectOption>
                <NativeSelectOption value="frozen">
                  {t("Frozen")}
                </NativeSelectOption>
                <NativeSelectOption value="archived">
                  {t("Archived")}
                </NativeSelectOption>
              </NativeSelect>
              <NativeSelect
                className="w-full"
                aria-label={t("Group type filter")}
                value={filters.type}
                onChange={(event) =>
                  updateFilters({ type: event.target.value as GroupType })
                }
              >
                <NativeSelectOption value="all">
                  {t("All group types")}
                </NativeSelectOption>
                <NativeSelectOption value="friends">
                  {t("Friend groups")}
                </NativeSelectOption>
                <NativeSelectOption value="study_group">
                  {t("Study groups")}
                </NativeSelectOption>
                <NativeSelectOption value="class">
                  {t("Self-declared classes")}
                </NativeSelectOption>
              </NativeSelect>
            </div>
          </CardContent>
        </Card>

        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Group")}</TableHead>
                <TableHead>{t("State")}</TableHead>
                <TableHead>{t("Members")}</TableHead>
                <TableHead>{t("Owner")}</TableHead>
                <TableHead>{t("Updated")}</TableHead>
                <TableHead className="text-right">
                  {t("Safety action")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.data?.items.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="max-w-64 whitespace-normal">
                    <p className="font-medium">{group.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {group.type === "class"
                        ? t("Self-declared class — not an official institution")
                        : group.type === "study_group"
                          ? t("Study group")
                          : t("Friend group")}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        group.state === "frozen" ? "destructive" : "outline"
                      }
                    >
                      {stateLabel(group.state, t)}
                    </Badge>
                  </TableCell>
                  <TableCell>{group.memberCount}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/users/${group.owner.id}`}
                      className="font-medium underline-offset-3 hover:underline"
                    >
                      {group.owner.name}
                    </Link>
                    <p className="max-w-52 truncate text-xs text-muted-foreground">
                      {group.owner.email}
                    </p>
                  </TableCell>
                  <TableCell>
                    {format.dateTime(group.updatedAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    {group.state === "archived" ? (
                      <span className="text-xs text-muted-foreground">
                        {t("No action")}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant={
                          group.state === "frozen" ? "outline" : "destructive"
                        }
                        onClick={() => {
                          setReason("")
                          setPending({
                            id: group.id,
                            name: group.name,
                            revision: group.revision,
                            frozen: group.state !== "frozen",
                          })
                        }}
                      >
                        {group.state === "frozen" ? null : (
                          <SnowflakeIcon aria-hidden />
                        )}
                        {group.state === "frozen" ? t("Unfreeze") : t("Freeze")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {groups.data?.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {t("No social group matches these filters.")}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {groups.data
              ? t("{count} groups", { count: String(groups.data.total) })
              : t("Loading groups…")}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={filters.offset === 0 || groups.isFetching}
              onClick={() =>
                updateFilters({
                  offset: Math.max(0, filters.offset - filters.limit),
                })
              }
            >
              {t("Previous")}
            </Button>
            <Button
              variant="outline"
              disabled={!hasNext || groups.isFetching}
              onClick={() =>
                updateFilters({ offset: filters.offset + filters.limit })
              }
            >
              {t("Next")}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open && !moderate.isPending) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.frozen
                ? t("Freeze this group?")
                : t("Unfreeze this group?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.frozen
                ? t(
                    "This immediately stops sharing for {group}. Members must consent again after a future unfreeze.",
                    { group: pending?.name ?? "" }
                  )
                : t(
                    "Access may resume for {group}, but every member remains consent-required and rankings stay off.",
                    { group: pending?.name ?? "" }
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="social-group-moderation-reason">
              {t("Moderation reason")}
            </Label>
            <Textarea
              id="social-group-moderation-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={10}
              maxLength={500}
              placeholder={t("Required for the protected audit trail")}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moderate.isPending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.frozen ? "destructive" : "default"}
              disabled={
                !pending || reason.trim().length < 10 || moderate.isPending
              }
              onClick={() =>
                pending &&
                moderate.mutate({
                  groupId: pending.id,
                  frozen: pending.frozen,
                  expectedRevision: pending.revision,
                  reason: reason.trim(),
                })
              }
            >
              {moderate.isPending ? <Spinner /> : null}
              {pending?.frozen ? t("Confirm freeze") : t("Confirm unfreeze")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
