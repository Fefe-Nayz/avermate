"use client";

import { useYearReview } from "@/hooks/use-year-review";
import { useActiveYearStore } from "@/stores/active-year-store";
import { YearReviewStory } from "./year-review-story";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, X, Play } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useYears } from "@/hooks/use-years";
import { usePathname } from "next/navigation";
import { useSession } from "@/hooks/use-session";
import { useTranslations } from "next-intl";

export function YearReviewTrigger() {
    const t = useTranslations("YearReview");
    const { activeId } = useActiveYearStore();
    const { data: years } = useYears();
    const { data: reviewData, isLoading } = useYearReview(activeId);
    const { data: session } = useSession();

    const [isOpen, setIsOpen] = useState(false);
    const [showPopup, setShowPopup] = useState(false);

    const pathname = usePathname();
    const isDashboard = pathname?.startsWith("/dashboard");

    const activeYear = years?.find(y => y.id === activeId);
    const yearLabel = activeYear ? activeYear.name : new Date().getFullYear().toString();
    const yearStartDate = activeYear ? new Date(activeYear.startDate) : undefined;
    const yearEndDate = activeYear ? new Date(activeYear.endDate) : undefined;

    const userName = session?.user?.name || undefined;
    const userAvatar = session?.user?.image || undefined;

    // Check if we should show the popup
    useEffect(() => {
        if (!reviewData?.hasData || !isDashboard) return;

        const dismissedKey = `year-review-dismissed-${activeId}`;
        const isDismissed = localStorage.getItem(dismissedKey);

        const yearNum = parseInt(yearLabel);
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        let shouldShow = false;

        if (!isNaN(yearNum)) {
            if (currentYear > yearNum) {
                shouldShow = true;
            } else if (currentYear === yearNum && currentMonth >= 11) {
                shouldShow = true;
            }
        } else {
            shouldShow = true;
        }

        if (shouldShow && !isDismissed) {
            const timer = setTimeout(() => setShowPopup(true), 2000);
            return () => clearTimeout(timer);
        }
    }, [reviewData, activeId, yearLabel, isDashboard]);

    const handleDismiss = () => {
        setShowPopup(false);
        const dismissedKey = `year-review-dismissed-${activeId}`;
        localStorage.setItem(dismissedKey, "true");
    };

    if (!reviewData?.hasData || !reviewData.stats) return null;

    return (
        <>
            {/* The Popup - appears in bottom center on mobile, bottom right on desktop */}
            <AnimatePresence>
                {showPopup && (
                    <motion.div
                        initial={{ opacity: 0, y: 30, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        transition={{ type: "spring", bounce: 0.3, duration: 0.5 }}
                        className="fixed bottom-24 md:bottom-8 left-4 right-4 md:left-auto md:right-8 z-50 max-w-sm mx-auto md:mx-0"
                    >
                        <div
                            className="bg-background/95 backdrop-blur-xl text-foreground p-4 rounded-2xl shadow-2xl flex items-center gap-4 cursor-pointer hover:bg-background transition-colors border border-border/50"
                            onClick={() => { setIsOpen(true); handleDismiss(); }}
                        >
                            <motion.div
                                className="bg-gradient-to-br from-violet-500 to-purple-600 p-3 rounded-xl shadow-lg shadow-purple-500/20"
                                animate={{ scale: [1, 1.05, 1] }}
                                transition={{ duration: 2, repeat: Infinity, repeatDelay: 2 }}
                            >
                                <Sparkles className="w-5 h-5 text-white" />
                            </motion.div>
                            <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-base">{t("trigger.popupTitle", { year: yearLabel })}</h3>
                                <p className="text-sm text-muted-foreground">{t("trigger.popupDescription")}</p>
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
                                className="p-2 hover:bg-muted rounded-full transition-colors shrink-0 text-muted-foreground hover:text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                                aria-label={t("trigger.dismiss")}
                            >
                                <X className="w-4 h-4" />
                            </button>
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
    const { data: reviewData } = useYearReview(activeId);
    const { data: session } = useSession();
    const [isOpen, setIsOpen] = useState(false);

    const activeYear = years?.find(y => y.id === activeId);
    const yearLabel = activeYear ? activeYear.name : "";
    const yearStartDate = activeYear ? new Date(activeYear.startDate) : undefined;
    const yearEndDate = activeYear ? new Date(activeYear.endDate) : undefined;

    const userName = session?.user?.name || undefined;
    const userAvatar = session?.user?.image || undefined;

    if (!reviewData?.hasData || !reviewData.stats) return null;

    return (
        <>
            <Card className="w-full">
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg shadow-purple-500/20">
                            <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                            <CardTitle className="text-base">{t("trigger.cardTitle", { year: yearLabel })}</CardTitle>
                            <CardDescription className="text-sm">{t("trigger.cardDescription")}</CardDescription>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="pt-0">
                    <div className="flex items-center justify-between gap-4">
                        <p className="text-sm text-muted-foreground">
                            {t("trigger.cardBody", { year: yearLabel })}
                        </p>
                        <Button
                            onClick={() => setIsOpen(true)}
                            size="sm"
                            className="shrink-0 gap-2"
                        >
                            <Play className="w-3.5 h-3.5" />
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
