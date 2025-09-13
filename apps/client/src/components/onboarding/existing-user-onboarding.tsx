"use client";

import { defineStepper } from "@/components/stepper";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  GraduationCap,
  BookOpen,
  Calendar,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useActiveYears } from "@/hooks/use-active-year";
import { ConfettiButton } from "@/components/magicui/confetti";
import { useYears } from "@/hooks/use-years";
import { useIsMobile } from "@/hooks/use-mobile";
import Link from "next/link";

// Step components
import YearStep from "./year-step";
import SubjectsStep from "./subjects-step";
import PeriodsStep from "./periods-step";

interface ExistingUserOnboardingProps {
  yearId: string; // "new" or actual year ID
}

const {
  Stepper: YearStepper,
  useStepper: useYearStepper,
  steps: yearSteps,
  utils: yearUtils,
} = defineStepper(
  { id: "year", title: "Year" },
  { id: "subjects", title: "Subjects" },
  { id: "periods", title: "Periods" }
);

const {
  Stepper: ConfigStepper,
  useStepper: useConfigStepper,
  steps: configSteps,
  utils: configUtils,
} = defineStepper(
  { id: "subjects", title: "Subjects" },
  { id: "periods", title: "Periods" }
);

export default function ExistingUserOnboarding({
  yearId,
}: ExistingUserOnboardingProps) {
  const t = useTranslations("Onboarding");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { select } = useActiveYears();
  const { data: years } = useYears();
  const isMobile = useIsMobile();

  const [currentYearId, setCurrentYearId] = useState<string | null>(
    yearId !== "new" ? yearId : null
  );
  const [isAnimating, setIsAnimating] = useState(false);

  const isNewYear = yearId === "new";
  const isConfiguring = !isNewYear && !!years?.find((y) => y.id === yearId);

  // Use different steppers based on whether creating new year or configuring existing
  if (isConfiguring) {
    return (
      <ConfigStepper.Provider
        initialStep="subjects"
        className="h-full flex flex-col"
        labelOrientation={isMobile ? "vertical" : "horizontal"}
      >
        {({ methods }) => (
          <ConfigOnboardingContent
            methods={methods}
            steps={configSteps}
            yearId={yearId}
            t={t}
            router={router}
            searchParams={searchParams}
            select={select}
            isAnimating={isAnimating}
            setIsAnimating={setIsAnimating}
          />
        )}
      </ConfigStepper.Provider>
    );
  }

  return (
    <YearStepper.Provider
      initialStep="year"
      className="h-full flex flex-col"
      labelOrientation={isMobile ? "vertical" : "horizontal"}
    >
      {({ methods }) => (
        <YearOnboardingContent
          methods={methods}
          steps={yearSteps}
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
    </YearStepper.Provider>
  );
}

interface YearOnboardingContentProps {
  methods: any;
  steps: any[];
  t: any;
  router: any;
  searchParams: any;
  select: any;
  currentYearId: string | null;
  setCurrentYearId: (id: string | null) => void;
  isAnimating: boolean;
  setIsAnimating: (animating: boolean) => void;
}

function YearOnboardingContent({
  methods,
  steps,
  t,
  router,
  searchParams,
  select,
  currentYearId,
  setCurrentYearId,
  isAnimating,
  setIsAnimating,
}: YearOnboardingContentProps) {
  const currentStep = methods.current;
  const currentIndex = yearUtils.getIndex(currentStep.id);
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
    if (isAnimating) return;

    // Special handling for year step
    if (currentStep.id === "year" && !currentYearId) {
      return;
    }

    if (!isLastStep) {
      const nextStepIndex = currentIndex + 1;
      if (nextStepIndex < steps.length) {
        methods.goTo(steps[nextStepIndex].id);
      }
    }
  };

  const handleBack = () => {
    if (isAnimating) return;

    // If at first step, go back to previous page with cancel
    if (currentIndex === 0) {
      router.back();
      return;
    }

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

    // Add yearId to URL as query parameter
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("yearId", yearId);
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
    // Navigation handled by Link wrapper
  };

  const canNavigateNext = () => {
    if (currentStep.id === "year" && !currentYearId) {
      return false;
    }
    return true;
  };

  function isStepCompleted(stepId: string) {
    const stepIndex = steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) return false;

    // A step is completed if we are STRICTLY past that step
    if (stepId === "year") {
      return currentIndex > stepIndex && !!currentYearId;
    }

    // For subjects and periods, they are completed if we're past them
    return currentIndex > stepIndex;
  }

  const canGoBack = () => {
    if (currentIndex <= 0) return false; // Can't go back from first step in this flow (should use router.back)
    const prevStepIndex = currentIndex - 1;
    if (prevStepIndex >= 0) {
      const prevStep = steps[prevStepIndex];
      // Cannot go back to completed year step
      if (prevStep.id === "year") {
        return !isStepCompleted(prevStep.id);
      }
      // Can freely navigate between subjects and periods
      return true;
    }
    return false;
  };

  // Helper function to get step icon
  function getStepIcon(stepId: string) {
    if (isStepCompleted(stepId)) {
      return <Check className="h-4 w-4" />;
    }

    switch (stepId) {
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

  const backButtonText = currentIndex === 0 ? t("cancel") : t("previous");

  return (
    <div className="h-full flex flex-col">
      {/* Desktop Header */}
      <div className="hidden md:flex items-center justify-between p-6 border-b">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold">
            {currentStep.id === "year"
              ? t("year")
              : currentStep.id === "subjects"
                ? t("matieres")
                : t("periodes")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("setupMessage")}</p>
        </div>

        <div className="flex items-center space-x-4">
          <Button
            size="sm"
            variant="outline"
            onClick={handleBack}
            disabled={isAnimating || (currentIndex > 0 && !canGoBack())}
          >
            {backButtonText}
          </Button>
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
          {currentStep.id === "year"
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
        <YearStepper.Navigation className="w-full">
          {steps.map((step) => {
            const isDisabled =
              // Completed year step can't be navigated back to
              (step.id === "year" && isStepCompleted(step.id)) ||
              // Future steps are disabled until year is created
              (step.id === "subjects" && !currentYearId) ||
              (step.id === "periods" && !currentYearId);

            return (
              <YearStepper.Step
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
                <YearStepper.Title>
                  {step.id === "year"
                    ? t("year")
                    : step.id === "subjects"
                      ? t("matieres")
                      : t("periodes")}
                </YearStepper.Title>
              </YearStepper.Step>
            );
          })}
        </YearStepper.Navigation>
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
        <Button
          size="sm"
          variant="outline"
          onClick={handleBack}
          disabled={isAnimating || (currentIndex > 0 && !canGoBack())}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          {backButtonText}
        </Button>

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

interface ConfigOnboardingContentProps {
  methods: any;
  steps: any[];
  yearId: string;
  t: any;
  router: any;
  searchParams: any;
  select: any;
  isAnimating: boolean;
  setIsAnimating: (animating: boolean) => void;
}

function ConfigOnboardingContent({
  methods,
  steps,
  yearId,
  t,
  router,
  searchParams,
  select,
  isAnimating,
  setIsAnimating,
}: ConfigOnboardingContentProps) {
  const currentStep = methods.current;
  const currentIndex = configUtils.getIndex(currentStep.id);
  const isLastStep = currentIndex === steps.length - 1;

  const handleNext = () => {
    if (isAnimating) return;
    if (!isLastStep) {
      const nextStepIndex = currentIndex + 1;
      if (nextStepIndex < steps.length) {
        methods.goTo(steps[nextStepIndex].id);
      }
    }
  };

  const handleBack = () => {
    if (isAnimating) return;

    // If at first step, go back to previous page with cancel
    if (currentIndex === 0) {
      router.back();
      return;
    }

    const prevStepIndex = currentIndex - 1;
    if (prevStepIndex >= 0) {
      methods.goTo(steps[prevStepIndex].id);
    }
  };

  // Helper function to determine if a step is completed
  function isStepCompleted(stepId: string) {
    const stepIndex = steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) return false;

    // A step is completed if we are STRICTLY past that step
    return currentIndex > stepIndex;
  }

  // Helper function to get step icon
  function getStepIcon(stepId: string) {
    if (isStepCompleted(stepId)) {
      return <Check className="h-4 w-4" />;
    }

    switch (stepId) {
      case "subjects":
        return <BookOpen className="h-4 w-4" />;
      case "periods":
        return <Calendar className="h-4 w-4" />;
      default:
        return <span className="text-sm font-medium">?</span>;
    }
  }

  const handleFinish = () => {
    select(yearId);
    // Navigation handled by Link wrapper
  };

  const canGoBack = () => {
    // In config flow, all steps are freely navigable (subjects and periods are optional)
    return currentIndex > 0;
  };

  const backButtonText = currentIndex === 0 ? t("cancel") : t("previous");

  return (
    <div className="h-full flex flex-col">
      {/* Desktop Header */}
      <div className="hidden md:flex items-center justify-between p-6 border-b">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold">
            {currentStep.id === "subjects" ? t("matieres") : t("periodes")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("setupMessage")}</p>
        </div>

        <div className="flex items-center space-x-4">
          <Button
            size="sm"
            variant="outline"
            onClick={handleBack}
            disabled={isAnimating || (currentIndex > 0 && !canGoBack())}
          >
            {backButtonText}
          </Button>
          {isLastStep ? (
            <Link href="/dashboard" onClick={handleFinish}>
              <ConfettiButton
                size="sm"
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
            <Button size="sm" onClick={handleNext} disabled={isAnimating}>
              {t("next")}
            </Button>
          )}
        </div>
      </div>

      {/* Mobile Header */}
      <div className="md:hidden p-4 border-b">
        <h1 className="text-xl font-bold">
          {currentStep.id === "subjects" ? t("matieres") : t("periodes")}
        </h1>
        <p className="text-muted-foreground text-xs mt-1">
          {t("setupMessage")}
        </p>
      </div>

      {/* Stepper Navigation */}
      <div className="px-6 py-4 border-b">
        <ConfigStepper.Navigation className="w-full">
          {steps.map((step) => (
            <ConfigStepper.Step
              key={step.id}
              of={step.id}
              icon={getStepIcon(step.id)}
              onClick={() => {
                if (!isAnimating) {
                  methods.goTo(step.id);
                }
              }}
            >
              <ConfigStepper.Title>
                {step.id === "subjects" ? t("matieres") : t("periodes")}
              </ConfigStepper.Title>
            </ConfigStepper.Step>
          ))}
        </ConfigStepper.Navigation>
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
            {currentStep.id === "subjects" && <SubjectsStep yearId={yearId} />}
            {currentStep.id === "periods" && <PeriodsStep yearId={yearId} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden sticky bottom-0 bg-background border-t p-4 flex justify-between items-center">
        <Button
          size="sm"
          variant="outline"
          onClick={handleBack}
          disabled={isAnimating}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          {backButtonText}
        </Button>

        {isLastStep ? (
          <Link href="/dashboard" onClick={handleFinish}>
            <ConfettiButton
              size="sm"
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
          <Button size="sm" onClick={handleNext} disabled={isAnimating}>
            {t("next")}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
