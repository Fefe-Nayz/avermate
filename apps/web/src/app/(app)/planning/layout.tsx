import type { Metadata } from "next"
import type { ReactNode } from "react"
import { PlanningNavigation } from "@/components/planning/planning-navigation"

export const metadata: Metadata = {
  title: "Planning",
  description: "School agenda, personal tasks and the timetable.",
  robots: { index: false, follow: false },
}

/**
 * The rail sits beside the content on a wide screen; the pill row it also
 * renders stacks above it on a phone. In the layout rather than in each of the
 * four screens, so the navigation does not re-mount — and cannot be forgotten —
 * when you move between them.
 */
export default function PlanningLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-8">
      <PlanningNavigation />
      <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
    </div>
  )
}
