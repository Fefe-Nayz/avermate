"use client"

import { useQuery } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { Spinner } from "@/components/ui/spinner"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { materialTagsInput } from "@/lib/route-query-inputs"
import { MaterialTagForm } from "./material-tag-form"
import type { MaterialTagView } from "./materials-types"

/**
 * Finding the tag being edited.
 *
 * There is no procedure that fetches one tag — the list is small and is always
 * already loaded — so the edit screen reads the list it came from rather than
 * the API growing an endpoint to answer a question the cache can answer. If the
 * tag is genuinely not there, the screen says so instead of rendering an empty
 * form that would create a second one on save.
 */
function useTags() {
  const { yearId } = useYear()
  const query = useQuery({
    ...orpc.materials.tags.list.queryOptions({
      input: materialTagsInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
  })
  return {
    tags: (query.data ?? []) as MaterialTagView[],
    isPending: query.isPending,
  }
}

function Loading() {
  return (
    <div className="grid place-items-center p-10">
      <Spinner className="size-5" />
    </div>
  )
}

export function MaterialTagCreate() {
  const { tags, isPending } = useTags()
  if (isPending) return <Loading />
  return <MaterialTagForm mode="create" tags={tags} />
}

export function MaterialTagEditor({ tagId }: { tagId: string }) {
  const t = useExtracted()
  const { tags, isPending } = useTags()
  const tag = tags.find((candidate) => candidate.id === tagId) ?? null

  if (isPending) return <Loading />
  if (!tag) {
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        {t("That tag no longer exists.")}
      </p>
    )
  }
  return <MaterialTagForm mode="edit" tag={tag} tags={tags} />
}
