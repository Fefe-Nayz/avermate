"use client"

import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  BookOpenIcon,
  GaugeIcon,
  UserRoundIcon,
  UserRoundMinusIcon,
} from "lucide-react"
import { useExtracted, useLocale } from "next-intl"
import { toast } from "sonner"
import { ReportDialog } from "@/components/social/report-dialog"
import {
  SharedAverage,
  SocialActions,
  SocialCallout,
  SocialEmpty,
  SocialHeading,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

/**
 * One friend. Their identity, then the figures they chose to share — real
 * averages on their own scale, not bands. The dangerous actions sit at the
 * bottom where they are deliberate rather than adjacent.
 */
export function FriendDetailClient({ friendshipId }: { friendshipId: string }) {
  const t = useExtracted()
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const detail = useQuery(
    orpc.social.friends.detail.queryOptions({ input: { friendshipId } })
  )

  const remove = useMutation({
    ...orpc.social.friends.remove.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Friend removed."))
      await queryClient.invalidateQueries({
        queryKey: orpc.social.friends.list.key(),
      })
      router.push("/social")
    },
  })
  const block = useMutation({
    ...orpc.social.blocks.create.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Account blocked."))
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.social.friends.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.blocks.list.key(),
        }),
      ])
      router.push("/social")
    },
  })

  if (detail.isLoading && !detail.isError) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  const friend = detail.data
  if (!friend) {
    return (
      <SocialEmpty
        icon={UserRoundIcon}
        title={t("This friend could not be found")}
        description={t("The friendship may have been removed.")}
        action={
          <Button variant="outline" onClick={() => router.push("/social")}>
            {t("Back to friends")}
          </Button>
        }
      />
    )
  }
  const sharing = friend.sharing

  return (
    <div className="flex flex-col gap-4">
      <SocialHeading
        icon={UserRoundIcon}
        title={friend.name}
        description={friend.handle ? `@${friend.handle}` : undefined}
        action={
          <Avatar className="size-12">
            {friend.avatar ? <AvatarImage src={friend.avatar} alt="" /> : null}
            <AvatarFallback>
              {(friend.name || "?").slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        }
      />

      {sharing ? (
        <>
          {sharing.shareGeneralAverage ? (
            <SocialSection
              icon={GaugeIcon}
              title={t("General average")}
              description={t("Computed from {year}", {
                year: sharing.year.name,
              })}
            >
              <div className="flex items-baseline gap-2">
                <SharedAverage
                  ratio={sharing.generalAverage}
                  scale={sharing.year.scale}
                  decimals={sharing.year.decimals}
                  locale={locale}
                  className="text-2xl"
                />
              </div>
            </SocialSection>
          ) : null}

          {sharing.subjects.length ? (
            <SocialSection
              icon={BookOpenIcon}
              title={t("Shared subjects")}
              description={t("Only what they unlocked appears here.")}
            >
              <SocialList>
                {sharing.subjects.map((subject) => (
                  <SocialRow
                    key={subject.id}
                    trailing={
                      <SharedAverage
                        ratio={subject.average}
                        scale={sharing.year.scale}
                        decimals={sharing.year.decimals}
                        locale={locale}
                      />
                    }
                  >
                    <p className="truncate text-sm font-medium">
                      {subject.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {subject.gradeCount === 1
                        ? t("1 grade")
                        : t("{count} grades", { count: String(subject.gradeCount) })}
                    </p>
                  </SocialRow>
                ))}
              </SocialList>
            </SocialSection>
          ) : null}
        </>
      ) : (
        <SocialCallout title={t("Nothing is shared right now")}>
          {t(
            "{name} has locked their figures, or has no academic year to share yet.",
            { name: friend.name }
          )}
        </SocialCallout>
      )}

      <SocialActions>
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button type="button" size="sm" variant="outline" />}
          >
            <UserRoundMinusIcon /> {t("Remove friend")}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Remove this friend?")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  "Neither of you will see the other's figures any more. Either of you can send a new request later."
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => remove.mutate({ friendshipId })}
              >
                {t("Remove friend")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
          <AlertDialogTrigger
            render={<Button type="button" size="sm" variant="ghost" />}
          >
            <BanIcon /> {t("Block")}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Block this account?")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  "The friendship ends immediately and they can no longer send you requests or invitations. They are not notified."
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => block.mutate({ userId: friend.userId })}
              >
                {t("Block")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <ReportDialog targetUserId={friend.userId} />
      </SocialActions>
    </div>
  )
}
