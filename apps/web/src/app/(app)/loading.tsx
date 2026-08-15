import { Spinner } from "@/components/ui/spinner"

/** Feedback while the authenticated shell is being prepared on first entry. */
export default function AppLoading() {
  return (
    // Half the viewport, not `min-h-svh`: inside the scroll pane (which is
    // already viewport-minus-header tall) a full-viewport placeholder adds
    // phantom scroll range during every transition, and that extra range is
    // what pushed the router into scrolling the new segment "into view".
    <div className="flex min-h-[50vh] items-center justify-center bg-background">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  )
}
