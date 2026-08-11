import { AverageForm } from "@/components/averages/average-form"
import { safeReturnPath } from "@/lib/safe-return-path"

export default async function NewAveragePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>
}) {
  const query = await searchParams
  return (
    <AverageForm
      mode="create"
      returnTo={safeReturnPath(query.returnTo, "/settings/averages")}
    />
  )
}
