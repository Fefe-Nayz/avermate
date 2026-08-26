import { getExtracted } from "next-intl/server"
import { Skeleton } from "@/components/ui/skeleton"

export default async function AvermateNodeSettingsLoading() {
  const t = await getExtracted()
  return (
    <div
      className="flex flex-col gap-4"
      aria-label={t("Loading Avermate Node settings")}
    >
      <Skeleton className="h-44" />
      <Skeleton className="h-52" />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  )
}
