import { LectureRecordingReader } from "@/components/recordings/lecture-recording-reader"
import { prepareAuthenticatedShell } from "@/lib/authenticated-data"
import { getServerOrpc } from "@/lib/orpc/server"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { HydrateClient } from "@/lib/query-server"
import { lectureRecordingInput } from "@/lib/route-query-inputs"

export default async function LectureRecordingPage({
  params,
}: {
  params: Promise<{ recordingId: string }>
}) {
  const [{ recordingId }, { queryClient }] = await Promise.all([
    params,
    prepareAuthenticatedShell(),
  ])
  const orpc = getServerOrpc()
  const input = lectureRecordingInput(recordingId)
  await Promise.all([
    queryClient.fetchQuery({
      ...orpc.recordings.get.queryOptions({ input }),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
    queryClient.fetchQuery({
      ...orpc.recordings.capabilities.queryOptions(),
      staleTime: COMMON_QUERY_STALE_TIME,
    }),
  ])

  return (
    <HydrateClient queryClient={queryClient}>
      <LectureRecordingReader recordingId={recordingId} />
    </HydrateClient>
  )
}
