"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ShieldBanIcon, Undo2Icon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  SocialEmpty,
  SocialList,
  SocialRow,
  SocialSection,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { orpc } from "@/lib/orpc"

export function BlocksManager() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const blocks = useQuery(orpc.social.blocks.list.queryOptions())
  const remove = useMutation({
    ...orpc.social.blocks.remove.mutationOptions(),
    onSuccess: async () => {
      toast.success(
        t(
          "Account unblocked. Previous friendship and permissions were not restored."
        )
      )
      await queryClient.invalidateQueries({
        queryKey: orpc.social.blocks.list.key(),
      })
    },
  })

  return (
    <SocialSection
      icon={ShieldBanIcon}
      title={t("Blocked accounts")}
      description={t("Unblocking never recreates what blocking ended.")}
      bodyClassName={blocks.data?.length ? "p-0 px-4 py-1" : undefined}
    >
      {blocks.data?.length ? (
        <SocialList>
          {blocks.data.map((block) => (
            <SocialRow
              key={block.id}
              trailing={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ blockId: block.id })}
                >
                  <Undo2Icon /> {t("Unblock")}
                </Button>
              }
            >
              <p className="truncate text-sm font-medium">
                {block.displayName || t("Blocked account")}
              </p>
            </SocialRow>
          ))}
        </SocialList>
      ) : (
        <SocialEmpty
          compact
          icon={ShieldBanIcon}
          title={t("Nobody is blocked")}
          description={t(
            "Blocking ends a friendship, its pending requests and every usable permission at once."
          )}
        />
      )}
    </SocialSection>
  )
}
