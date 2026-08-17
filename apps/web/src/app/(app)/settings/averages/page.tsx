"use client"

import Link from "next/link"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronRightIcon, PlusIcon, SigmaIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { resolveCustomAverage } from "@avermate/core"
import { Button } from "@/components/ui/button"
import {
  DragHandle,
  sortableListClassName,
  sortableRowClassName,
  sortableRowLinkClassName,
  SortableList,
  SortableRow,
} from "@/components/ui/sortable-list"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageMeta } from "@/components/shell/page-chrome"
import { AverageValue } from "@/components/data/value"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { invalidateAnnouncementAudience } from "@/lib/announcement-cache"

export default function AveragesSettingsPage() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { customAverages, graph, yearId } = useYear()

  const reorder = useMutation({
    ...orpc.averages.reorder.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.snapshot.get.queryKey({
            input: { yearId: yearId ?? "" },
          }),
        }),
        invalidateAnnouncementAudience(queryClient),
      ])
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The averages could not be reordered."))
    },
  })

  const reorderAverages = (averageIds: string[]) => {
    if (reorder.isPending) return
    reorder.mutate({ averageIds })
  }

  return (
    <>
      <PageMeta title={t("Custom averages")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
            {t("Custom averages")}
          </h1>
          <Button
            size="sm"
            className="ml-auto"
            render={<Link href="/settings/averages/new" />}
          >
            <PlusIcon className="size-4" />
            {t("New")}
          </Button>
        </div>

        {customAverages.length === 0 ? (
          <Empty className="rounded-xl border border-dashed py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SigmaIcon />
              </EmptyMedia>
              <EmptyTitle>{t("No custom averages")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "Combine any subjects with weights of your own — written exams only, or the science block, or whatever your school actually grades you on."
                )}
              </EmptyDescription>
            </EmptyHeader>
            <Button render={<Link href="/settings/averages/new" />}>
              <PlusIcon className="size-4" />
              {t("Create one")}
            </Button>
          </Empty>
        ) : (
          <SortableList
            ids={customAverages.map((average) => average.id)}
            onReorder={reorderAverages}
          >
            <ul className={sortableListClassName}>
              {customAverages.map((average, index) => {
                const resolved = resolveCustomAverage(graph, average)
                const ratio = resolved.graph.ratio(null, resolved.scope)

                return (
                  <SortableRow
                    key={average.id}
                    id={average.id}
                    disabled={reorder.isPending}
                    className={sortableRowClassName(index)}
                  >
                    <DragHandle className="ml-1.5" />
                    <Link
                      href={`/settings/averages/${average.id}`}
                      className={sortableRowLinkClassName}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          {average.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("{count} subjects", {
                            count: String(average.entries.length),
                          })}
                        </p>
                      </div>
                      <AverageValue
                        ratio={ratio}
                        showScale
                        colored
                        className="font-medium"
                      />
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
                    </Link>
                  </SortableRow>
                )
              })}
            </ul>
          </SortableList>
        )}
      </div>
    </>
  )
}
