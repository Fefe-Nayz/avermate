"use client"

import { useEffect, type ReactNode } from "react"
import { useTheme } from "next-themes"
import { Toaster } from "@/components/ui/sonner"
import { MotionPolicyProvider } from "@/components/motion-policy-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { useIsMobile } from "@/hooks/use-mobile"
import { loadHapticsPreference } from "@/lib/haptics"

function ToasterBridge() {
  const { resolvedTheme } = useTheme()
  const isMobile = useIsMobile()
  return (
    /*
     * `950ad6a` set out to stop the toaster swallowing clicks aimed at the
     * page, and put `pointer-events-none` on the wrong element. Measured at
     * that revision: the container was `auto`, so its empty column still ate
     * clicks — the very bug — while the toast itself was `none`, so a hit-test
     * over a toast landed on `body`. Sonner pauses its dismiss timer on hover
     * and dismisses on swipe, and both need the pointer to reach the toast, so
     * a long error message ran out mid-sentence with no way to hold it or send
     * it away. `b40ef32` noticed half of this and exempted buttons.
     *
     * The transparency belongs on the container, which is mostly empty space.
     * The toasts inside it stay interactive.
     */
    <Toaster
      position={isMobile ? "top-center" : "bottom-right"}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      className="pointer-events-none"
      toastOptions={{
        classNames: { toast: "pointer-events-auto pt-safe md:pt-0" },
      }}
    />
  )
}

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    loadHapticsPreference()
  }, [])

  return (
    <ThemeProvider>
      {/*
       * The animated landing components suspend themselves when they scroll
       * out of view, when the tab is hidden, or when the reader asks for
       * reduced motion. All three answers come from here, so it has to sit
       * above anything that animates continuously.
       */}
      <MotionPolicyProvider>
        {children}
        <ToasterBridge />
      </MotionPolicyProvider>
    </ThemeProvider>
  )
}
