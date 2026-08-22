"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { Spinner } from "@/components/ui/spinner"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import {
  planningAssignmentsInput,
  planningTasksInput,
} from "@/lib/route-query-inputs"
import { PlanningAssignmentForm } from "./planning-assignment-form"
import { normalizePlanningItems, type PlanningItem } from "./planning-model"
import { PlanningTaskForm } from "./planning-task-form"

/**
 * Finding the thing being edited.
 *
 * There is no procedure that fetches one task or one piece of homework — the
 * lists are small and always already loaded — so the edit screens read the list
 * they came from rather than the API growing two endpoints to answer a question
 * the cache can answer. If it is genuinely not there, the screen says so
 * instead of rendering an empty form that would create a second copy on save.
 */

function Missing({ what }: { what: string }) {
  return (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      {what}
    </p>
  )
}

function Loading() {
  return (
    <div className="grid place-items-center p-10">
      <Spinner className="size-5" />
    </div>
  )
}

export function PlanningTaskEditor({ taskId }: { taskId: string }) {
  const t = useExtracted()
  const { yearId } = useYear()
  const query = useQuery({
    ...orpc.planning.tasks.list.queryOptions({
      input: planningTasksInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
  })
  const item = useFound(query.data, "task", taskId)

  if (query.isPending) return <Loading />
  if (!item) return <Missing what={t("That task no longer exists.")} />
  return <PlanningTaskForm yearId={yearId ?? ""} mode="edit" item={item} />
}

export function PlanningAssignmentEditor({
  assignmentId,
}: {
  assignmentId: string
}) {
  const t = useExtracted()
  const { yearId } = useYear()
  const query = useQuery({
    ...orpc.planning.assignments.list.queryOptions({
      input: planningAssignmentsInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
  })
  const item = useFound(query.data, "assignment", assignmentId)

  if (query.isPending) return <Loading />
  if (!item) return <Missing what={t("That homework no longer exists.")} />
  return (
    <PlanningAssignmentForm yearId={yearId ?? ""} mode="edit" item={item} />
  )
}

function useFound(
  data: unknown,
  kind: PlanningItem["kind"],
  id: string
): PlanningItem | null {
  return useMemo(() => {
    const items = normalizePlanningItems(data, kind)
    return items.find((item) => item.id === id) ?? null
  }, [data, id, kind])
}
