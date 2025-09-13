"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useHasExistingData } from "@/hooks/use-has-existing-data";
import NewUserOnboarding from "@/components/onboarding/new-user-onboarding";
import ExistingUserOnboarding from "@/components/onboarding/existing-user-onboarding";
import { Loader2Icon } from "lucide-react";

function OnboardingContent() {
  const hasExistingData = useHasExistingData();
  const searchParams = useSearchParams();
  const [initialUserType, setInitialUserType] = React.useState<
    "new" | "existing" | null
  >(null);

  // Lock in the user type on first load - don't let it change during onboarding
  React.useEffect(() => {
    if (hasExistingData !== undefined && initialUserType === null) {
      // Check if we have the newuseronboarding flag - if so, force new user flow
      const isNewUserOnboarding =
        searchParams.get("newuseronboarding") === "true";

      if (isNewUserOnboarding) {
        setInitialUserType("new");
      } else {
        setInitialUserType(hasExistingData ? "existing" : "new");
      }
    }
  }, [hasExistingData, initialUserType, searchParams]);

  if (initialUserType === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2Icon className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // New user gets welcome screen + full onboarding
  if (initialUserType === "new") {
    return <NewUserOnboarding />;
  }

  // Existing user creating new year (no welcome screen)
  return <ExistingUserOnboarding yearId="new" />;
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <Loader2Icon className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
