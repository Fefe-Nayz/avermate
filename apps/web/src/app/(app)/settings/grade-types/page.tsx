"use client"

import Link from "next/link"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronRightIcon, PlusIcon, TagsIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
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
import { cardAccent } from "@/components/cards/card-accent"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"

/**
 * The kinds of assessment this year holds.
 *
 * The same screen as the custom averages, deliberately: both are a short list of things
 * the reader defined, both are reordered by hand, and both open a small form. A settings
 * section that invented its own shape for each list would make the second one feel like a
 * different app.
 *
 * The order is the one that matters — it is the order a card's axis draws them in, and the
 * order the picker offers them when a result is written — so the list is sortable rather
 * than alphabetical.
 */
export default function GradeTypesSettingsPage() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { gradeTypes, yearId } = useYear()

  const reorder = useMutation({
    ...orpc.gradeTypes.reorder.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The types could not be reordered."))
    },
  })

  return (
    <>
      <PageMeta title={t("Assessment types")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
            {t("Assessment types")}
          </h1>
          <Button
            size="sm"
            className="ml-auto"
            render={<Link href="/settings/grade-types/new" />}
          >
            <PlusIcon className="size-4" />
            {t("New")}
          </Button>
        </div>

        {gradeTypes.length === 0 ? (
          <Empty className="rounded-xl border border-dashed py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TagsIcon />
              </EmptyMedia>
              <EmptyTitle>{t("No assessment types")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "Name the kinds of assessment your year actually has — a test, an oral, a lab report. Each one fills in a result's name, coefficient and scale for you, and lets a card compare one kind against another."
                )}
              </EmptyDescription>
            </EmptyHeader>
            <Button render={<Link href="/settings/grade-types/new" />}>
              <PlusIcon className="size-4" />
              {t("Create one")}
            </Button>
          </Empty>
        ) : (
          <SortableList
            ids={gradeTypes.map((type) => type.id)}
            onReorder={(typeIds) => {
              if (reorder.isPending) return
              reorder.mutate({ yearId: yearId ?? "", typeIds })
            }}
          >
            <ul className={sortableListClassName}>
              {gradeTypes.map((type, index) => {
                const accent = cardAccent(type.accent)
                return (
                  <SortableRow
                    key={type.id}
                    id={type.id}
                    disabled={reorder.isPending}
                    className={sortableRowClassName(index)}
                  >
                    <DragHandle className="ml-1.5" />
                    <Link
                      href={`/settings/grade-types/${type.id}`}
                      className={sortableRowLinkClassName}
                    >
                      {/* The colour, where one was chosen — the same dot a card wears, so
                          a type and its cards are recognisably the same thing. */}
                      <span
                        aria-hidden
                        className={cn(
                          "size-2.5 shrink-0 rounded-full",
                          accent ? accent.swatch : "border border-dashed"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {type.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {/* What it fills in, which is the whole of what a type does. */}
                          {[
                            // Quoted and untrimmed: the trailing space of "DS " is
                            // what makes the next result "DS 3", so it is shown.
                            type.titlePrefix.trim()
                              ? t('starts with "{prefix}"', {
                                  prefix: type.titlePrefix,
                                })
                              : null,
                            t("coefficient {coefficient}", {
                              coefficient: String(type.coefficient),
                            }),
                            t("out of {outOf}", { outOf: String(type.outOf) }),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
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
