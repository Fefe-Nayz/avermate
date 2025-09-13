"use client";

import { Suspense } from "react";
import ExistingUserOnboarding from "@/components/onboarding/existing-user-onboarding";
import { Loader2Icon } from "lucide-react";

function NewYearOnboardingContent() {
  return <ExistingUserOnboarding yearId="new" />;
}

export default function NewYearOnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <Loader2Icon className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <NewYearOnboardingContent />
    </Suspense>
  );
}
