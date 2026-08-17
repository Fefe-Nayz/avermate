import { PeriodForm } from "@/components/year/period-form"
import { safeReturnPath } from "@/lib/safe-return-path"

export default async function NewPeriodPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>
}) {
  const query = await searchParams
  return (
    <PeriodForm
      mode="create"
      returnTo={safeReturnPath(query.returnTo, "/settings/year")}
    />
  )
}
