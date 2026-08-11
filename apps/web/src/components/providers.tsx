"use client"

import { useEffect, type ReactNode } from "react"
import { useTheme } from "next-themes"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/theme-provider"
import { loadHapticsPreference } from "@/lib/haptics"

function ToasterBridge() {
  const { resolvedTheme } = useTheme()
  return (
    <Toaster
      position="top-center"
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      className="md:right-4 md:bottom-4"
      toastOptions={{ classNames: { toast: "pt-safe md:pt-0" } }}
    />
  )
}

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    loadHapticsPreference()
  }, [])

  return (
    <ThemeProvider>
      {children}
      <ToasterBridge />
    </ThemeProvider>
  )
}
