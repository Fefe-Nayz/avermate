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
    <Toaster
      position={isMobile ? "top-center" : "bottom-right"}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      toastOptions={{
        classNames: { toast: "pointer-events-none pt-safe md:pt-0" },
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
