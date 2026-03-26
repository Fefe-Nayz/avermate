import * as React from "react"
import { usePathname } from "next/navigation"
import { useIsMobile } from "./use-mobile"

export function useMobileScrollReset() {
  const pathname = usePathname()
  const isMobile = useIsMobile()

  React.useEffect(() => {
    if (!isMobile) return

    window.scrollTo(0, 0)
  }, [isMobile, pathname])
}
