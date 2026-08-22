import { getExtracted } from "next-intl/server"
import { Skeleton } from "@/components/ui/skeleton"

export default async function LearningLoading() {
  const t = await getExtracted()
  return (
    <div
      className="flex flex-col gap-4"
      aria-label={t("Loading the learning workspace")}
    >
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  )
}
