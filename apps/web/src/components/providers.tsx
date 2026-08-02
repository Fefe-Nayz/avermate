"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { queryClient, SESSION_LOST_EVENT } from "@/lib/orpc";
import { loadHapticsPreference } from "@/lib/haptics";
import { AppearanceSync } from "@/components/theme/appearance-sync";

function SessionWatcher() {
  useEffect(() => {
    const onLost = () => {
      // A dead session on a screen full of stale data is worse than a redirect:
      // every action would fail with no explanation.
      const target = `${window.location.pathname}${window.location.search}`;
      if (target.startsWith("/auth") || target === "/") return;
      window.location.replace(`/auth/sign-in?next=${encodeURIComponent(target)}`);
    };
    window.addEventListener(SESSION_LOST_EVENT, onLost);
    return () => window.removeEventListener(SESSION_LOST_EVENT, onLost);
  }, []);
  return null;
}

function ToasterBridge() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="top-center"
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      className="md:bottom-4 md:right-4"
      toastOptions={{ classNames: { toast: "pt-safe md:pt-0" } }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    loadHapticsPreference();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delay={200}>
          <AppearanceSync />
          <SessionWatcher />
          {children}
          <ToasterBridge />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
