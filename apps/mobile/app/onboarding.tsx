import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { Loading } from "@/components/ui";
import { YearSetupWizard } from "@/components/year-setup-wizard";
import { useYear } from "@/components/year-provider";
import { useSession } from "@/lib/auth-client";
import { loadYearSetupDraft } from "@/lib/year-setup-draft";

/**
 * First run and additional years intentionally share one resumable flow.
 *
 * Like the web's first-run wizard, this route is only for accounts with no
 * year yet: landing here with years already set up and no saved setup draft
 * (a re-verified email, a stale deep link) leaves for the app instead of
 * offering to create another year. The decision is made once, before the
 * wizard ever renders, so an in-progress setup is never redirected away.
 */
export default function OnboardingRoute() {
  const { allYears, isLoading } = useYear();
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const [decision, setDecision] = useState<"pending" | "wizard" | "leave">(
    "pending",
  );

  useEffect(() => {
    if (decision !== "pending" || isLoading) return;
    if (allYears.length === 0) {
      setDecision("wizard");
      return;
    }
    if (!userId) return;
    let alive = true;
    loadYearSetupDraft(userId)
      .then((draft) => {
        if (alive) setDecision(draft ? "wizard" : "leave");
      })
      .catch(() => {
        // Unreadable storage cannot prove there is no draft; the wizard
        // itself degrades safely in that case.
        if (alive) setDecision("wizard");
      });
    return () => {
      alive = false;
    };
  }, [allYears.length, decision, isLoading, userId]);

  if (decision === "leave") return <Redirect href="/(tabs)" />;
  if (decision === "pending") return <Loading />;
  return <YearSetupWizard />;
}
