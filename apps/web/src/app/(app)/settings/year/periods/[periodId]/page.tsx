import { EditPeriodClient } from "./edit-period-client"
import { safeReturnPath } from "@/lib/safe-return-path"

export default async function EditPeriodPage({
  params,
  searchParams,
}: {
  params: Promise<{ periodId: string }>
  searchParams: Promise<{ returnTo?: string | string[] }>
}) {
  const [{ periodId }, query] = await Promise.all([params, searchParams])
  return (
    <EditPeriodClient
      periodId={periodId}
      returnTo={safeReturnPath(query.returnTo, "/settings/year")}
    />
  )
}
