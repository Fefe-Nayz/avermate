import type { ReactNode } from "react"
import { SettingsNavigation } from "./settings-navigation"

/**
 * Settings.
 *
 * On a wide screen the sections sit in a rail beside the content. On a phone
 * they are ordinary pages reached from the "More" tab and left with the back
 * arrow — no nested navigation inside a scroll container.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-8">
      <SettingsNavigation />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
