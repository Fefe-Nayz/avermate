"use client";

import ResendVerificationLink from "@/components/buttons/auth/resend-verification-link";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { usePollingSession } from "@/hooks/use-polling-session";

const VerifyEmailPage = () => {
  const t = useTranslations("Auth.Verify");
  const router = useRouter();
  const toaster = useToast();

  // Get session update
  const {
    data: session,
    isPending: isSessionPending,
  } = usePollingSession();

  // On session update
  useEffect(() => {
    // When email is verified redirect to dashboard
    if (session?.user.emailVerified) {
      // Redirect to the onboarding
      router.push("/onboarding");

      // Send toast notification
      toaster.toast({
        title: t("welcomeBack", { name: session.user.name }),
        description: t("hopeYouAchievedGoals"),
      });
    }
  }, [session]);

  return (
    <div className="flex flex-col gap-8">
      {/* Title */}
      <div className="flex flex-col gap-2">
        <p className="text-3xl md:text-4xl font-bold">{t("verifyEmail")}</p>

        <div className="flex flex-col gap-0.5 text-sm md:text-base text-muted-foreground">
          <p>{t("emailSent", { email: session?.user?.email || "" })}</p>
        </div>
      </div>

      {/* Form */}
      {!isSessionPending ? (
        <ResendVerificationLink email={session?.user.email || ""} />
      ) : (
        <Skeleton className="" />
      )}
    </div>
  );
};

export default VerifyEmailPage;
