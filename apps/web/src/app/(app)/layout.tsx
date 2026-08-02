"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/lib/auth-client";
import { YearProvider } from "@/components/year/year-provider";
import { YearGate } from "@/components/year/year-gate";
import { AppShell } from "@/components/shell/app-shell";
import { PageChromeProvider } from "@/components/shell/page-chrome";
import { QuickAddProvider } from "@/components/shell/quick-add";
import { CommandPaletteProvider } from "@/components/command/command-palette";
import { FeedbackProvider } from "@/components/feedback/feedback-provider";

/** The signed-in area: auth gate, year context, and the shell around it. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (isPending || session) return;
    const target = `${window.location.pathname}${window.location.search}`;
    router.replace(`/auth/sign-in?next=${encodeURIComponent(target)}`);
  }, [isPending, session, router]);

  if (isPending || !session) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <YearProvider>
      <PageChromeProvider>
        <CommandPaletteProvider>
          <FeedbackProvider>
            <QuickAddProvider>
              <AppShell user={session.user}>
                <YearGate>{children}</YearGate>
              </AppShell>
            </QuickAddProvider>
          </FeedbackProvider>
        </CommandPaletteProvider>
      </PageChromeProvider>
    </YearProvider>
  );
}
