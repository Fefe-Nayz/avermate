"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  SearchIcon,
  SnowflakeIcon,
  Trash2Icon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { GroupStateMark } from "@/components/admin/social-moderation-ui"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  SocialEmpty,
  SocialHeading,
  SocialList,
  SocialRow,
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SelectControl } from "@/components/forms/controls"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { INITIAL_ADMIN_SOCIAL_GROUPS_INPUT } from "@/lib/admin-social-inputs"
import { orpc } from "@/lib/orpc"

/**
 * Every group on the instance. Two actions exist: hold (figures hidden,
 * nothing lost) and delete. Holds are for reports; deletion is for spam.
 */
export function AdminSocialGroupsClient() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState<string>(
    INITIAL_ADMIN_SOCIAL_GROUPS_INPUT.search
  )
  const [state, setState] = useState<"all" | "active" | "frozen">(
    INITIAL_ADMIN_SOCIAL_GROUPS_INPUT.state
  )
  const groups = useQuery(
    orpc.admin.socialGroups.queryOptions({ input: { search, state } })
  )

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: orpc.admin.socialGroups.key() })

  const setGroupState = useMutation({
    ...orpc.admin.setSocialGroupState.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      toast.success(
        result.state === "frozen"
          ? t("Class placed on hold.")
          : t("Hold lifted.")
      )
      await refresh()
    },
  })
  const remove = useMutation({
    ...orpc.admin.deleteSocialGroup.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Class deleted."))
      await refresh()
    },
  })

  return (
    <>
      <PageMeta title={t("Classes")} />
      <div className="flex flex-col gap-4">
        <SocialHeading
          icon={UsersRoundIcon}
          title={t("Classes")}
          description={t("Hold a reported class, or delete it outright.")}
        />

        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-52 flex-1">
            <SearchIcon
              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Search by name…")}
              className="pl-9"
            />
          </div>
          <SelectControl
            aria-label={t("State")}
            value={state}
            onValueChange={(value) =>
              setState(value as "all" | "active" | "frozen")
            }
            className="w-40"
            options={[
              { value: "all", label: t("All states") },
              { value: "active", label: t("Active") },
              { value: "frozen", label: t("On hold") },
            ]}
          />
        </div>

        {groups.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : groups.data?.length ? (
          <SocialList>
            {groups.data.map((group) => (
              <SocialRow
                key={group.id}
                trailing={
                  <div className="flex items-center gap-2">
                    <GroupStateMark state={group.state} />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={setGroupState.isPending}
                      onClick={() =>
                        setGroupState.mutate({
                          groupId: group.id,
                          state: group.state === "frozen" ? "active" : "frozen",
                        })
                      }
                    >
                      <SnowflakeIcon />
                      {group.state === "frozen" ? t("Lift hold") : t("Hold")}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("Delete class")}
                          />
                        }
                      >
                        <Trash2Icon />
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t("Delete this class?")}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t(
                              "It disappears for every member. Nobody's grades are affected."
                            )}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => remove.mutate({ groupId: group.id })}
                          >
                            {t("Delete class")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                }
              >
                <p className="truncate text-sm font-medium">{group.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {t("Owner: {name}", { name: group.ownerName })}
                  {" · "}
                  {group.memberCount === 1
                    ? t("1 member")
                    : t("{count} members", {
                        count: String(group.memberCount),
                      })}
                </p>
              </SocialRow>
            ))}
          </SocialList>
        ) : (
          <SocialEmpty
            icon={UsersRoundIcon}
            title={t("No classes match")}
            description={t("Adjust the search or the state filter.")}
          />
        )}
      </div>
    </>
  )
}
