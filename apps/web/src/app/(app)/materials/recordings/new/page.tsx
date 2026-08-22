import {
  LectureRecorder,
  type LecturePlanningContext,
} from "@/components/recordings/lecture-recorder"
import type { MaterialFolderView } from "@/components/materials/materials-types"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"
import { materialsFoldersInput } from "@/lib/route-query-inputs"

export default async function NewLectureRecordingPage({
  searchParams,
}: {
  searchParams: Promise<{
    folderId?: string
    title?: string
    subjectId?: string
    eventId?: string
    occurrenceId?: string
    seriesId?: string
    occurrenceDate?: string
    startsAt?: string
  }>
}) {
  const [params, { activeYearId, queryClient }] = await Promise.all([
    searchParams,
    prepareAuthenticatedShell(),
  ])
  const { folderId, title, subjectId } = params
  const orpc = getServerOrpc()
  const [folders] = await Promise.all([
    queryClient.fetchQuery({
      ...orpc.materials.folders.list.queryOptions({
        input: materialsFoldersInput(activeYearId),
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }) as Promise<MaterialFolderView[]>,
    queryClient.fetchQuery({
      ...orpc.recordings.capabilities.queryOptions(),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
  ])
  const safeFolderId =
    folderId && folders.some((folder) => folder.id === folderId)
      ? folderId
      : null
  const planningContext = parsePlanningContext(params)

  return (
    <HydrateClient queryClient={queryClient}>
      <LectureRecorder
        initialFolderId={safeFolderId}
        initialTitle={title?.trim().slice(0, 160) ?? ""}
        initialSubjectId={subjectId?.trim() || null}
        initialPlanningContext={planningContext}
      />
    </HydrateClient>
  )
}

function parsePlanningContext(input: {
  eventId?: string
  occurrenceId?: string
  seriesId?: string
  occurrenceDate?: string
  startsAt?: string
}): LecturePlanningContext | null {
  const startsAt = input.startsAt?.trim() || null
  const eventId = input.eventId?.trim()
  if (eventId) {
    return { kind: "calendarEvent", eventId, startsAt }
  }
  const occurrenceId = input.occurrenceId?.trim()
  if (occurrenceId) {
    return { kind: "occurrence", occurrenceId, startsAt }
  }
  const seriesId = input.seriesId?.trim()
  const occurrenceDate = input.occurrenceDate?.trim()
  if (seriesId && /^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate ?? "")) {
    return {
      kind: "seriesOccurrence",
      seriesId,
      occurrenceDate: occurrenceDate!,
      startsAt,
    }
  }
  return null
}
