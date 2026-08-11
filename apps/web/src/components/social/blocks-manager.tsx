"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ShieldBanIcon, Undo2Icon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldBanIcon className="size-4" /> {t("Blocked accounts")}
        </CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            "Blocking ends the friendship, pending requests and usable sharing immediately. Unblocking never recreates them."
          )}
        </p>
      </CardHeader>
      <CardContent className="px-4">
        {blocks.data?.length ? (
          <ul className="divide-y rounded-lg border">
            {blocks.data.map((block) => (
              <li
                key={block.id}
                className="flex items-center justify-between gap-3 p-3"
              >
                <span className="truncate text-sm font-medium">
                  {block.displayName || t("Blocked account")}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ blockId: block.id })}
                >
                  <Undo2Icon /> {t("Unblock")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("No blocked accounts.")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
