"use client";

import { defineStepper } from "@/components/stepper";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Heart,
  GraduationCap,
  BookOpen,
  Calendar,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useActiveYears } from "@/hooks/use-active-year";
import { ConfettiButton } from "@/components/magicui/confetti";
import { useIsMobile } from "@/hooks/use-mobile";
import Link from "next/link";

// Step components
import WelcomeStep from "./welcome-step";
import YearStep from "./year-step";
import SubjectsStep from "./subjects-step";
import PeriodsStep from "./periods-step";

const { Stepper, useStepper, steps, utils } = defineStepper(
  { id: "welcome", title: "Welcome" },
  { id: "year", title: "Year" },
  { id: "subjects", title: "Subjects" },
  { id: "periods", title: "Periods" }
);

export default function NewUserOnboarding() {
  const t = useTranslations("Onboarding");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { select } = useActiveYears();
  const [currentYearId, setCurrentYearId] = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const isMobile = useIsMobile();

  return (
    <Stepper.Provider
      initialStep="welcome"
      className="h-full flex flex-col"
      labelOrientation={isMobile ? "vertical" : "horizontal"}
    >
      {({ methods }) => (
        <OnboardingContent
          methods={methods}
          t={t}
          router={router}
          searchParams={searchParams}
          select={select}
          currentYearId={currentYearId}
          setCurrentYearId={setCurrentYearId}
          isAnimating={isAnimating}
          setIsAnimating={setIsAnimating}
        />
      )}
    </Stepper.Provider>
  );
}

interface OnboardingContentProps {
  methods: any;
  t: any;
  router: any;
  searchParams: any;
  select: any;
  currentYearId: string | null;
  setCurrentYearId: (id: string | null) => void;
  isAnimating: boolean;
  setIsAnimating: (animating: boolean) => void;
}

function OnboardingContent({
  methods,
  t,
  router,
  searchParams,
  select,
  currentYearId,
  setCurrentYearId,
  isAnimating,
  setIsAnimating,
}: OnboardingContentProps) {
  const currentStep = methods.current;
  const currentIndex = utils.getIndex(currentStep.id);
  const isLastStep = currentIndex === steps.length - 1;

  // Check for yearId in URL on mount and restore state
  useEffect(() => {
    const yearIdFromUrl = searchParams.get("yearId");
    if (yearIdFromUrl && !currentYearId) {
      console.log("Restoring yearId from URL:", yearIdFromUrl);
      setCurrentYearId(yearIdFromUrl);
      // Navigate to subjects step since year is already created
      setTimeout(() => {
        methods.goTo("subjects");
      }, 100);
    }
  }, [searchParams, currentYearId, setCurrentYearId, methods]);

  const handleNext = () => {
    console.log("handleNext called", {
      isAnimating,
      currentStep: currentStep?.id,
      currentIndex,
      isLastStep,
      currentYearId,
      nextStepWouldBe:
        currentIndex + 1 < steps.length ? steps[currentIndex + 1]?.id : "none",
    });

    if (isAnimating) return;

    // Special handling for year step - make sure year is created
    if (currentStep.id === "year" && !currentYearId) {
      console.log("Cannot proceed from year step - no year created");
      return;
    }

    if (!isLastStep) {
      const nextStepIndex = currentIndex + 1;
      if (nextStepIndex < steps.length) {
        console.log("Navigating to:", steps[nextStepIndex].id);
        methods.goTo(steps[nextStepIndex].id);
      }
    }
  };

  const handleBack = () => {
    if (isAnimating) return;

    const prevStepIndex = currentIndex - 1;
    if (prevStepIndex >= 0) {
      methods.goTo(steps[prevStepIndex].id);
    }
  };

  const handleYearCreated = (yearId: string) => {
    console.log("handleYearCreated called with:", yearId, {
      currentStep: currentStep?.id,
      currentIndex,
      isLastStep,
    });
    setCurrentYearId(yearId);

    // Add yearId and newuseronboarding flag to URL as query parameters
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("yearId", yearId);
    currentUrl.searchParams.set("newuseronboarding", "true");
    router.replace(currentUrl.pathname + currentUrl.search, { scroll: false });

    // Small delay so stepper re-evaluates disabled state before navigating
    setTimeout(() => {
      const nextStepIndex = Math.min(currentIndex + 1, steps.length - 1);
      const nextStepId = steps[nextStepIndex]?.id;
      if (nextStepId && nextStepId !== currentStep.id) {
        methods.goTo(nextStepId);
      }
    }, 150);
  };

  const handleFinish = () => {
    if (currentYearId) {
      select(currentYearId);
    }
    // Clean up URL parameters - navigation handled by Link wrapper
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete("yearId");
    currentUrl.searchParams.delete("newuseronboarding");
  };

  const canNavigateNext = () => {
    if (currentStep.id === "year" && !currentYearId) {
      return false;
    }
    return true;
  };

  const canGoBack = () => {
    // Can always go back unless we're at the first step
    if (currentIndex <= 0) return false;

    const prevStepIndex = currentIndex - 1;
    if (prevStepIndex >= 0) {
      const prevStep = steps[prevStepIndex];
      // When on year step, allow going back to welcome
      if (currentStep.id === "year" && prevStep.id === "welcome") {
        return true;
      }
      // After passing year, do not allow going back to welcome/year
      if (prevStep.id === "welcome" || prevStep.id === "year") {
        return false;
      }
      // Can freely navigate between subjects and periods
      return true;
    }
    return false;
  };

  const showBackButton = currentIndex > 0;

  // Helper function to determine if a step is completed
  function isStepCompleted(stepId: string) {
    const stepIndex = steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) return false;

    // A step is completed if we are STRICTLY past that step
    if (stepId === "welcome") {
      return currentIndex > stepIndex;
    }
    if (stepId === "year") {
      return currentIndex > stepIndex && !!currentYearId;
    }

    // For subjects and periods, they are completed if we're past them
    return currentIndex > stepIndex;
  }

  // Helper function to get step icon
  function getStepIcon(stepId: string) {
    if (isStepCompleted(stepId)) {
      return <Check className="h-4 w-4" />;
    }

    switch (stepId) {
      case "welcome":
        return <Heart className="h-4 w-4" />;
      case "year":
        return <GraduationCap className="h-4 w-4" />;
      case "subjects":
        return <BookOpen className="h-4 w-4" />;
      case "periods":
        return <Calendar className="h-4 w-4" />;
      default:
        return <span className="text-sm font-medium">?</span>;
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Desktop Header */}
      <div className="hidden md:flex items-center justify-between p-6 border-b">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold">
            {currentStep.id === "welcome"
              ? t("welcome")
              : currentStep.id === "year"
                ? t("year")
                : currentStep.id === "subjects"
                  ? t("matieres")
                  : t("periodes")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("setupMessage")}</p>
        </div>

        <div className="flex items-center space-x-4">
          {showBackButton && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleBack}
              disabled={isAnimating || !canGoBack()}
            >
              {t("previous")}
            </Button>
          )}
          {isLastStep ? (
            <Link href="/dashboard" onClick={handleFinish}>
              <ConfettiButton
                size="sm"
                disabled={!currentYearId}
                options={{
                  particleCount: 100,
                  spread: 70,
                  origin: { y: 0.6 },
                }}
              >
                {t("finish")} 🎉
              </ConfettiButton>
            </Link>
          ) : (
            <Button
              size="sm"
              onClick={handleNext}
              disabled={isAnimating || !canNavigateNext()}
            >
              {t("next")}
            </Button>
          )}
        </div>
      </div>

      {/* Mobile Header */}
      <div className="md:hidden p-4 border-b">
        <h1 className="text-xl font-bold">
          {currentStep.id === "welcome"
            ? t("welcome")
            : currentStep.id === "year"
              ? t("year")
              : currentStep.id === "subjects"
                ? t("matieres")
                : t("periodes")}
        </h1>
        <p className="text-muted-foreground text-xs mt-1">
          {t("setupMessage")}
        </p>
      </div>

      {/* Stepper Navigation */}
      <div className="px-6 py-4 border-b">
        <Stepper.Navigation className="w-full">
          {steps.map((step) => {
            const isDisabled =
              // Welcome is clickable when currently on year; otherwise disabled once completed
              (step.id === "welcome"
                ? currentStep.id !== "year" && isStepCompleted("welcome")
                : false) ||
              // Year is disabled once completed
              (step.id === "year" && isStepCompleted("year")) ||
              // Future steps are disabled until year is created
              (step.id === "subjects" && !currentYearId) ||
              (step.id === "periods" && !currentYearId);

            return (
              <Stepper.Step
                key={step.id}
                of={step.id}
                icon={getStepIcon(step.id)}
                disabled={isDisabled}
                onClick={() => {
                  if (!isDisabled && !isAnimating) {
                    methods.goTo(step.id);
                  }
                }}
              >
                <Stepper.Title>
                  {step.id === "welcome"
                    ? t("welcome")
                    : step.id === "year"
                      ? t("year")
                      : step.id === "subjects"
                        ? t("matieres")
                        : t("periodes")}
                </Stepper.Title>
              </Stepper.Step>
            );
          })}
        </Stepper.Navigation>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto overflow-x-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep.id}
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -100 }}
            transition={{ duration: 0.3 }}
            onAnimationStart={() => setIsAnimating(true)}
            onAnimationComplete={() => setIsAnimating(false)}
            className="h-full p-6"
          >
            {currentStep.id === "welcome" && (
              <WelcomeStep onNext={handleNext} />
            )}
            {currentStep.id === "year" && (
              <YearStep yearId="new" onYearCreated={handleYearCreated} />
            )}
            {currentStep.id === "subjects" && currentYearId && (
              <SubjectsStep yearId={currentYearId} />
            )}
            {currentStep.id === "periods" && currentYearId && (
              <PeriodsStep yearId={currentYearId} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden sticky bottom-0 bg-background border-t p-4 flex justify-between items-center">
        {showBackButton ? (
          <Button
            size="sm"
            variant="outline"
            onClick={handleBack}
            disabled={isAnimating || !canGoBack()}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            {t("previous")}
          </Button>
        ) : (
          <div />
        )}

        {isLastStep ? (
          <Link href="/dashboard" onClick={handleFinish}>
            <ConfettiButton
              size="sm"
              disabled={!currentYearId}
              options={{
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 },
              }}
            >
              {t("finish")} 🎉
            </ConfettiButton>
          </Link>
        ) : (
          <Button
            size="sm"
            onClick={handleNext}
            disabled={isAnimating || !canNavigateNext()}
          >
            {t("next")}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
