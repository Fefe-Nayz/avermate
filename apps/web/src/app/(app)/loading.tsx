import { Spinner } from "@/components/ui/spinner"

/** Feedback while the authenticated shell is being prepared on first entry. */
export default function AppLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  )
}
