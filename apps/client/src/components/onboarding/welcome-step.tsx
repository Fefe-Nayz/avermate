"use client";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth";
import { Session, User } from "better-auth/types";
import {
  ArrowRight,
  ShareIcon,
  SquarePlusIcon,
  Download,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { handleError } from "@/utils/error-utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface WelcomeStepProps {
  onNext: () => void;
}

export default function WelcomeStep({ onNext }: WelcomeStepProps) {
  const t = useTranslations("Onboarding.Welcome");
  const errorTranslations = useTranslations("Errors");
  const { data: session } = authClient.useSession() as unknown as {
    data: { session: Session; user: User };
  };
  const queryClient = useQueryClient();

  // Detect iOS (iPhone)
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const onIphone = /iphone/.test(userAgent);
    setIsIos(onIphone);
  }, []);

  // PWA install logic (mostly for Android/Chrome)
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setInstallPrompt(e);
      setCanInstall(true);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
    };
  }, []);

  useEffect(() => {
    function handleAppInstalled() {
      disableInAppInstallPrompt();
    }

    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    const result = await (installPrompt as any).prompt();
    console.log(`Install prompt outcome: ${result.outcome}`);
    disableInAppInstallPrompt();
  };

  function disableInAppInstallPrompt() {
    setInstallPrompt(null);
    setCanInstall(false);
  }

  const { mutate: resetAccount, isPending } = useMutation({
    mutationKey: ["reset-account"],
    mutationFn: async () => {
      await apiClient.post("users/reset");
    },
    onSuccess: () => {
      toast.success(t("accountResetSuccess"), {
        description: t("accountResetDescription"),
      });
      queryClient.invalidateQueries();
      onNext();
    },
    onError: (error) => {
      handleError(error, errorTranslations, t("resetAccountError"));
    },
  });

  const handleIOSInstallClick = () => {
    setShowIOSInstructions(!showIOSInstructions);
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="text-center space-y-8 max-w-2xl w-full">
        <div className="space-y-4">
          <h2 className="text-3xl md:text-4xl font-bold text-primary">
            {t("welcomeTitle")},&nbsp;
            <span className="inline-flex items-center">
              {session?.user?.name ? (
                session.user.name.split(" ")[0]
              ) : (
                <Skeleton className="w-32 h-11 inline-block align-middle" />
              )}
            </span>
            &nbsp;! 🎉
          </h2>

          <p className="text-lg md:text-xl text-muted-foreground">
            {t("welcomeMessage")}
          </p>
        </div>

        {/* Install Section */}
        <div className="space-y-4">
          {/* PWA Install Button for Android/Chrome */}
          {canInstall && (
            <>
              <div className="space-y-3">
                <p className="text-base text-muted-foreground">
                  {t("installAppMessage")}
                </p>
                <Button onClick={handleInstallClick} size="lg">
                  <Download className="mr-3 h-5 w-5" />
                  {t("installAppButton")}
                </Button>
              </div>
            </>
          )}

          {/* iOS Install Button */}
          {!canInstall && isIos && (
            <>
              <div className="space-y-3">
                <p className="text-base text-muted-foreground">
                  {t("installAppMessageIOS")}
                </p>
                <Button
                  onClick={handleIOSInstallClick}
                  variant="default"
                  size="lg"
                >
                  <Download className="mr-3 h-5 w-5" />
                  {t("installAppButtonIOS")}
                  {showIOSInstructions ? (
                    <ChevronUp className="ml-3 h-5 w-5" />
                  ) : (
                    <ChevronDown className="ml-3 h-5 w-5" />
                  )}
                </Button>
              </div>

              {/* Expandable iOS Instructions */}
              <AnimatePresence>
                {showIOSInstructions && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="text-left bg-secondary/80 p-6 rounded-lg border">
                      <h4 className="text-lg font-semibold mb-4 text-center">
                        {t("installOnIphoneTitle")}
                      </h4>
                      <p className="text-sm text-muted-foreground mb-4 text-center">
                        {t("installOnIphoneMessage")}
                      </p>
                      <ol className="list-decimal list-inside text-sm space-y-3">
                        <li className="flex items-start">
                          <span className="mr-2">1.</span>
                          <span>{t("openInSafari")}</span>
                        </li>
                        <li className="flex items-start">
                          <span className="mr-2">2.</span>
                          <span>
                            {t.rich("tapShareIcon", {
                              share: (chunks) => <strong>{chunks}</strong>,
                            })}{" "}
                            <ShareIcon className="inline-block w-4 h-4 ml-1 align-text-bottom" />{" "}
                            {t("atBottomOfScreen")}
                          </span>
                        </li>
                        <li className="flex items-start">
                          <span className="mr-2">3.</span>
                          <span>
                            {t.rich("selectAddToHomeScreen", {
                              addToHomeScreen: (chunks) => (
                                <strong>{chunks}</strong>
                              ),
                            })}{" "}
                            <SquarePlusIcon className="inline-block w-4 h-4 ml-1 align-text-bottom" />
                          </span>
                        </li>
                        <li className="flex items-start">
                          <span className="mr-2">4.</span>
                          <span>
                            {t.rich("tapAddToConfirm", {
                              add: (chunks) => <strong>{chunks}</strong>,
                            })}
                          </span>
                        </li>
                      </ol>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {/* For devices that don't support PWA and aren't iOS */}
          {!canInstall && !isIos && (
            <div className="space-y-3">
              <p className="text-base text-muted-foreground">
                {t("getStartedMessage")}
              </p>
            </div>
          )}

          {/* Continue Button */}
          <div className="">
            <Button onClick={onNext} variant="outline" size="lg">
              {t("continueToSetup")}
              <ArrowRight className="ml-3 h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Reset Account Option (for debugging/development) */}
        {process.env.NODE_ENV === "development" && (
          <div className="pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                >
                  Reset Account (Dev Only)
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("resetAccountTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("resetAccountDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => resetAccount()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={isPending}
                  >
                    {t("confirmReset")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </div>
  );
}
