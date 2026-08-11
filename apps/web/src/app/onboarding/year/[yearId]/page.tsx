import { notFound } from "next/navigation"
import { YearConfigurationWizard } from "@/components/onboarding/year-configuration-wizard"
import { getServerOrpc } from "@/lib/orpc/server"
import { getServerQueryClient, HydrateClient } from "@/lib/query-server"

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: string }).code === "NOT_FOUND" ||
      (error as { code?: string }).code === "FORBIDDEN")
  )
}

export default async function ConfigureYearPage({
  params,
  searchParams,
}: {
  params: Promise<{ yearId: string }>
  searchParams: Promise<{ step?: string | string[] }>
}) {
  const [{ yearId }, query] = await Promise.all([params, searchParams])
  const queryClient = getServerQueryClient()
  const orpc = getServerOrpc()
  const statusOptions = orpc.years.configurationStatus.queryOptions({
    input: { yearId },
  })

  const status = await (async () => {
    try {
      return await queryClient.fetchQuery(statusOptions)
    } catch (error) {
      if (isMissing(error)) notFound()
      throw error
    }
  })()

  await Promise.all([
    queryClient.prefetchQuery(
      orpc.snapshot.get.queryOptions({ input: { yearId } })
    ),
    queryClient.prefetchQuery(orpc.presets.list.queryOptions()),
    queryClient.prefetchQuery(orpc.presets.periodTemplates.queryOptions()),
    queryClient.prefetchQuery(
      orpc.presets.status.queryOptions({ input: { yearId } })
    ),
  ])

  const requestedStep = Array.isArray(query.step) ? query.step[0] : query.step
  const initialStep =
    requestedStep === "periods"
      ? "periods"
      : requestedStep === "subjects"
        ? "subjects"
        : status.recommendedStep === "periods"
          ? "periods"
          : "subjects"

  return (
    <HydrateClient queryClient={queryClient}>
      <YearConfigurationWizard yearId={yearId} initialStep={initialStep} />
    </HydrateClient>
  )
}
