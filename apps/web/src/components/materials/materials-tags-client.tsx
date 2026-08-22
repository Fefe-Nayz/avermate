"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PencilIcon, PlusIcon, TagIcon, Trash2Icon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { PageActions } from "@/components/shell/page-chrome"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  lectureRecordingsInput,
  materialTagsInput,
  materialsDocumentsInput,
  materialsFoldersInput,
  studyDocumentsInput,
} from "@/lib/route-query-inputs"
import { cn } from "@/lib/utils"
import { materialsLocationHref } from "./materials-location"
import { materialTagCounts, materialTagDotClass } from "./materials-tags"
import type { MaterialTagView } from "./materials-types"

/**
 * The tags in this year, and what they are on.
 *
 * A page rather than a dialog, for the reason every list in this app is one:
 * you arrive here from the rail, you leave by going somewhere, and the browser's
 * back button should mean what it looks like it means. It also gives the count
 * somewhere to live — a tag nothing wears is a tag you meant to delete, and it
 * should say so rather than lead to an empty list.
 */
export function MaterialsTagsClient() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { yearId, subjects } = useYear()
  const [removing, setRemoving] = useState<MaterialTagView | null>(null)

  const tagsQuery = useQuery({
    ...orpc.materials.tags.list.queryOptions({
      input: materialTagsInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  /**
   * The counts come from the four lists the browser already reads, so arriving
   * here from Supports costs nothing; arriving cold costs four cached reads.
   */
  const foldersQuery = useQuery({
    ...orpc.materials.folders.list.queryOptions({
      input: materialsFoldersInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const documentsQuery = useQuery({
    ...orpc.materials.documents.list.queryOptions({
      input: materialsDocumentsInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const studyQuery = useQuery({
    ...orpc.documents.list.queryOptions({
      input: studyDocumentsInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const recordingsQuery = useQuery({
    ...orpc.recordings.list.queryOptions({
      input: lectureRecordingsInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  const tags = (tagsQuery.data ?? []) as MaterialTagView[]
  const counts = useMemo(
    () =>
      materialTagCounts([
        ...(foldersQuery.data ?? []).map((row) => ({
          tagIds: row.tagIds ?? [],
        })),
        ...(documentsQuery.data ?? []).map((row) => ({
          tagIds: row.document.tagIds ?? [],
        })),
        ...(studyQuery.data ?? []).map((row) => ({ tagIds: row.tagIds ?? [] })),
        ...(recordingsQuery.data ?? []).map((row) => ({
          tagIds: row.tagIds ?? [],
        })),
      ]),
    [
      documentsQuery.data,
      foldersQuery.data,
      recordingsQuery.data,
      studyQuery.data,
    ]
  )
  const subjectName = useMemo(
    () => new Map(subjects.map((subject) => [subject.id, subject.name])),
    [subjects]
  )

  const remove = useMutation({
    ...orpc.materials.tags.delete.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setRemoving(null)
      toast.success(t("Tag deleted."))
      // A deleted tag comes off everything wearing it, so the lists are stale.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.materials.tags.key() }),
        queryClient.invalidateQueries({
          queryKey: orpc.materials.documents.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.materials.folders.key(),
        }),
        queryClient.invalidateQueries({ queryKey: orpc.documents.list.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.recordings.list.key() }),
      ])
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The tag could not be deleted."))
    },
  })

  return (
    <>
      <PageActions>
        <Button size="sm" render={<Link href="/materials/tags/new" />}>
          <PlusIcon /> {t("New tag")}
        </Button>
      </PageActions>

      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        {tagsQuery.isPending ? (
          <div className="grid min-h-48 place-items-center">
            <Spinner className="size-5" />
          </div>
        ) : tags.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TagIcon />
              </EmptyMedia>
              <EmptyTitle>{t("No tags yet.")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "A folder says where something sits and a source says where it came from. A tag says what it is about — across both."
                )}
              </EmptyDescription>
            </EmptyHeader>
            <Button render={<Link href="/materials/tags/new" />}>
              <PlusIcon /> {t("New tag")}
            </Button>
          </Empty>
        ) : (
          <ul className="divide-y rounded-xl border">
            {tags.map((tag) => {
              const count = counts.get(tag.id) ?? 0
              return (
                <li
                  key={tag.id}
                  className="flex min-h-14 items-center gap-3 px-3"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-3 shrink-0 rounded-full",
                      materialTagDotClass(tag.color)
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={materialsLocationHref({
                        kind: "tag",
                        tagId: tag.id,
                      })}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {tag.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        tag.subjectId
                          ? subjectName.get(tag.subjectId)
                          : undefined,
                        t(
                          "{count, plural, =0 {On nothing yet} one {On # item} other {On # items}}",
                          { count }
                        ),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Edit {name}", { name: tag.name })}
                    render={<Link href={`/materials/tags/${tag.id}/edit`} />}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Delete {name}", { name: tag.name })}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setRemoving(tag)}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {t("Delete {name}?", { name: removing?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {/* Worth saying plainly: a tag holds no content, so nothing is
                  lost but the label. That is a very different sentence from
                  the one deleting a folder deserves. */}
              {t(
                "It comes off everything wearing it. The documents themselves are untouched."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate({ tagId: removing.id })}
            >
              {remove.isPending ? <Spinner /> : null}
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
