import { Skeleton } from "@/components/ui/skeleton"

export default function CopyWorkspaceLoading() {
  return (
    <div className="grid min-h-[70vh] gap-4 lg:grid-cols-2">
      <Skeleton />
      <Skeleton />
    </div>
  )
}
