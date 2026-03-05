"use client";

import { useYearReview } from "@/hooks/use-year-review";
import { useActiveYearStore } from "@/stores/active-year-store";
import { YearReviewStory } from "./year-review-story";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CalendarRange, X, Play } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useYears } from "@/hooks/use-years";
import { usePathname } from "next/navigation";
import { useSession } from "@/hooks/use-session";
import { useTranslations } from "next-intl";

const USER_YEAR_REVIEW_WINDOW_BEFORE_END_RATIO = 0.1;
const USER_YEAR_REVIEW_WINDOW_AFTER_END_RATIO = 0.05;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function isCalendarYearRange(yearStartTimestamp: number, yearEndTimestamp: number) {
  const yearStartDate = new Date(yearStartTimestamp);
  const yearEndDate = new Date(yearEndTimestamp);

  return (
    yearStartDate.getFullYear() === yearEndDate.getFullYear() &&
    yearStartDate.getMonth() === 0 &&
    yearStartDate.getDate() === 1 &&
    yearEndDate.getMonth() === 11 &&
    yearEndDate.getDate() === 31
  );
}

function isWithinYearReviewRevealWindow({
  now,
  yearStartTimestamp,
  yearEndTimestamp,
}: {
  now: Date;
  yearStartTimestamp: number;
  yearEndTimestamp: number;
}) {
  const revealAt = new Date(yearEndTimestamp);
  revealAt.setHours(23, 59, 59, 999);
  const endTimestamp = revealAt.getTime();

  if (
    Number.isNaN(yearStartTimestamp) ||
    Number.isNaN(endTimestamp) ||
    endTimestamp <= yearStartTimestamp
  ) {
    return false;
  }

  const yearEndDate = new Date(yearEndTimestamp);

  // Calendar years reveal throughout December only.
  if (isCalendarYearRange(yearStartTimestamp, yearEndTimestamp)) {
    return now.getMonth() === 11 && now.getFullYear() === yearEndDate.getFullYear();
  }

  const duration = Math.max(endTimestamp - yearStartTimestamp, DAY_IN_MS);
  const revealWindowStart =
    endTimestamp - duration * USER_YEAR_REVIEW_WINDOW_BEFORE_END_RATIO;
  const revealWindowEnd =
    endTimestamp + duration * USER_YEAR_REVIEW_WINDOW_AFTER_END_RATIO;
  const nowTimestamp = now.getTime();

  return nowTimestamp >= revealWindowStart && nowTimestamp <= revealWindowEnd;
}

export function YearReviewTrigger() {
  const t = useTranslations("YearReview");
  const { activeId } = useActiveYearStore();
  const { data: years } = useYears();
  const { data: reviewData } = useYearReview(activeId);
  const { data: session } = useSession();

  const [isOpen, setIsOpen] = useState(false);
  const [showPopup, setShowPopup] = useState(false);

  const pathname = usePathname();
  const isDashboard = pathname?.startsWith("/dashboard");

  const activeYear = years?.find((y) => y.id === activeId);
  const yearLabel = activeYear
    ? activeYear.name
    : new Date().getFullYear().toString();
  const yearStartTimestamp = activeYear
    ? new Date(activeYear.startDate).getTime()
    : undefined;
  const yearEndTimestamp = activeYear
    ? new Date(activeYear.endDate).getTime()
    : undefined;
  const yearStartDate =
    yearStartTimestamp !== undefined && !Number.isNaN(yearStartTimestamp)
      ? new Date(yearStartTimestamp)
      : undefined;
  const yearEndDate =
    yearEndTimestamp !== undefined && !Number.isNaN(yearEndTimestamp)
      ? new Date(yearEndTimestamp)
      : undefined;

  const userName = session?.user?.name || undefined;
  const userAvatar = session?.user?.image || undefined;

  // Check if we should show the popup
  useEffect(() => {
    if (
      !reviewData?.hasData ||
      !isDashboard ||
      !activeId ||
      yearStartTimestamp === undefined ||
      yearEndTimestamp === undefined
    ) {
      return;
    }

    if (Number.isNaN(yearStartTimestamp) || Number.isNaN(yearEndTimestamp)) {
      return;
    }

    if (
      !isWithinYearReviewRevealWindow({
        now: new Date(),
        yearStartTimestamp,
        yearEndTimestamp,
      })
    ) {
      return;
    }

    const dismissedKey = `year-review-dismissed-${activeId}`;
    const isDismissed = localStorage.getItem(dismissedKey);

    if (isDismissed) {
      return;
    }

    const timer = setTimeout(() => setShowPopup(true), 2000);
    return () => clearTimeout(timer);
  }, [reviewData?.hasData, isDashboard, activeId, yearStartTimestamp, yearEndTimestamp]);

  const handleDismiss = () => {
    setShowPopup(false);
    const dismissedKey = `year-review-dismissed-${activeId}`;
    localStorage.setItem(dismissedKey, "true");
  };
  if (!reviewData?.hasData || !reviewData.stats) return null;

  return (
    <>
      {/* The popup - styled close to shadcn/sonner surfaces */}
      <AnimatePresence>
        {showPopup && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", bounce: 0.14, duration: 0.4 }}
            className="fixed bottom-24 md:bottom-8 left-4 right-4 md:left-auto md:right-8 z-50 max-w-sm mx-auto md:mx-0"
          >
            <div
              className="rounded-xl border bg-popover/95 text-popover-foreground shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/90 transition-colors hover:bg-accent/30"
              onClick={() => {
                setIsOpen(true);
                handleDismiss();
              }}
            >
              <div className="flex items-start gap-3 p-4">
                <div className="rounded-md border bg-muted p-2 text-muted-foreground">
                  <CalendarRange className="size-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-sm leading-none">
                    {t("trigger.popupTitle", { year: yearLabel })}
                  </h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {t("trigger.popupDescription")}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 px-3"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(true);
                        handleDismiss();
                      }}
                    >
                      <Play className="size-3.5" />
                      {t("trigger.playRecap")}
                    </Button>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDismiss();
                  }}
                  className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={t("trigger.dismiss")}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <YearReviewStory
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        stats={reviewData.stats}
        year={yearLabel}
        yearStartDate={yearStartDate}
        yearEndDate={yearEndDate}
        userName={userName}
        userAvatar={userAvatar}
      />
    </>
  );
}

// Export a card section component to be used in settings
export function YearReviewSection() {
  const t = useTranslations("YearReview");
  const { activeId } = useActiveYearStore();
  const { data: years } = useYears();
  const { data: reviewData, isLoading: isReviewLoading } = useYearReview(activeId);
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);

  const activeYear = years?.find((y) => y.id === activeId);
  const yearLabel = activeYear ? activeYear.name : "";
  const yearStartDate = activeYear ? new Date(activeYear.startDate) : undefined;
  const yearEndDate = activeYear ? new Date(activeYear.endDate) : undefined;

  const userName = session?.user?.name || undefined;
  const userAvatar = session?.user?.image || undefined;

  if (isReviewLoading) {
    return (
      <Card className="w-full gap-0">
        <CardHeader className="pb-6">
          <div className="flex items-start gap-3">
            <Skeleton className="size-8 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="border-t px-6 pt-6 pb-0">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!reviewData?.hasData || !reviewData.stats) return null;

  return (
    <>
      <Card className="w-full gap-0">
        <CardHeader className="pb-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg border bg-muted p-2 text-muted-foreground">
              <CalendarRange className="size-4" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base">
                {t("trigger.cardTitle", { year: yearLabel })}
              </CardTitle>
              <CardDescription className="text-sm">
                {t("trigger.cardDescription")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="border-t px-6 pt-6 pb-0">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {t("trigger.cardBody", { year: yearLabel })}
            </p>
            <Button onClick={() => setIsOpen(true)} size="sm" className="shrink-0 gap-2">
              <Play className="size-3.5" />
              {t("trigger.playRecap")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <YearReviewStory
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        stats={reviewData.stats}
        year={yearLabel}
        yearStartDate={yearStartDate}
        yearEndDate={yearEndDate}
        userName={userName}
        userAvatar={userAvatar}
      />
    </>
  );
}

// Legacy button export for backwards compatibility
export function YearReviewButton() {
  return <YearReviewSection />;
}

