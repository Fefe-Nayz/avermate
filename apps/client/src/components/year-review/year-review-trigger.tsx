"use client";

import { useYearReview } from "@/hooks/use-year-review";
import { useActiveYearStore } from "@/stores/active-year-store";
import { YearReviewStory } from "./year-review-story";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useYears } from "@/hooks/use-years";
import { usePathname } from "next/navigation";
import { useSession } from "@/hooks/use-session";

export function YearReviewTrigger() {
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
            {/* The Popup */}
            <AnimatePresence>
                {showPopup && (
                    <motion.div
                        initial={{ opacity: 0, y: 50, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 50, scale: 0.9 }}
                        className="fixed bottom-20 right-4 z-40 max-w-sm bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-4 rounded-xl shadow-2xl flex items-center gap-4 cursor-pointer"
                        onClick={() => { setIsOpen(true); handleDismiss(); }}
                    >
                        <div className="bg-white/20 p-2 rounded-lg">
                            <Sparkles className="w-6 h-6 text-yellow-300 animate-pulse" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold">Your {yearLabel} Recap is here!</h3>
                            <p className="text-sm opacity-90">Tap to watch your year in review.</p>
                        </div>
                        <button 
                            onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
                            className="p-1 hover:bg-white/20 rounded-full"
                            aria-label="Dismiss"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <YearReviewStory 
                isOpen={isOpen} 
                onClose={() => setIsOpen(false)} 
                stats={reviewData.stats}
                year={yearLabel}
                userName={userName}
                userAvatar={userAvatar}
            />
        </>
    );
}

// Export a button component to be used in settings/nav
export function YearReviewButton() {
    const { activeId } = useActiveYearStore();
    const { data: years } = useYears();
    const { data: reviewData } = useYearReview(activeId);
    const { data: session } = useSession();
    const [isOpen, setIsOpen] = useState(false);

    const activeYear = years?.find(y => y.id === activeId);
    const yearLabel = activeYear ? activeYear.name : "";

    const userName = session?.user?.name || undefined;
    const userAvatar = session?.user?.image || undefined;

    if (!reviewData?.hasData || !reviewData.stats) return null;

    return (
        <>
             <Button 
                variant="outline" 
                className="w-full justify-start gap-2 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 dark:border-indigo-800 dark:hover:bg-indigo-950 dark:hover:text-indigo-300"
                onClick={() => setIsOpen(true)}
            >
                <Sparkles className="w-4 h-4 text-indigo-500" />
                Play {yearLabel} Recap
            </Button>

            <YearReviewStory 
                isOpen={isOpen} 
                onClose={() => setIsOpen(false)} 
                stats={reviewData.stats}
                year={yearLabel}
                userName={userName}
                userAvatar={userAvatar}
            />
        </>
    );
}
