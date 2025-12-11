"use client";

import { motion, AnimatePresence, animate, useMotionValue, useTransform } from "framer-motion";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Share2, Sparkles, Trophy, TrendingUp, Calendar, Zap, Award, Star, Activity, Rocket, Pause, Play, Crown, BookOpen, Target, Scale, RefreshCcw, Dices, Shuffle, Crosshair, Gem, UserCheck, Plane, Volume2, VolumeX } from "lucide-react";
import { YearReviewStats, Award as AwardData, AwardType } from "@/types/year-review";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import confetti from "canvas-confetti";
import { toPng } from "html-to-image";
import LightPillar from "@/components/LightPillar";
import { useFormatter, useTranslations } from "next-intl";

// --- Canonical Size for Stories ---
// The story is designed for this fixed resolution and scaled to fit any screen
const CANONICAL_WIDTH = 390;
const CANONICAL_HEIGHT = 693;
const STORY_ASPECT_RATIO = CANONICAL_WIDTH / CANONICAL_HEIGHT;

// Furniture sizes at 100% zoom (in CSS pixels at zoom=1)
const NAV_BUTTON_SIZE_BASE = 70;
const CLOSE_BUTTON_SIZE_BASE = 32;
const BUTTON_GAP_BASE = 16;
const CLOSE_BUTTON_GAP_BASE = 12;
const MIN_MARGIN_BASE = 20; // Minimum margin in pixels at 100% zoom

// Threshold: hide nav buttons when PHYSICAL viewport width is below this
// (we use screen width to make this zoom-independent)
const NAV_BUTTON_HIDE_THRESHOLD = 600;

// Hook to calculate zoom level - cross-browser (Chrome + Firefox)
function useZoomLevel() {
    const [zoom, setZoom] = useState(1);

    useEffect(() => {
        const updateZoom = () => {
            let detectedZoom = 1;

            // Detect browser
            const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('firefox');

            if (isFirefox) {
                // Firefox: Always use devicePixelRatio approach
                // In Firefox, DPR changes directly with zoom: DPR = nativeDPR * zoomFactor
                // 
                // IMPORTANT: We cannot reliably distinguish between Retina displays and zoomed
                // standard displays. For example, DPR=2 could be:
                // - Standard display at 200% zoom
                // - Retina display at 100% zoom
                // 
                // Any threshold we use to detect Retina will cause a "jump" when zoom crosses it.
                // Therefore, we always assume nativeDPR = 1 (standard display).
                // 
                // Tradeoff: On Retina displays, buttons will be 2x the intended physical size,
                // but at least zoom changes won't cause sudden jumps in button sizes.
                const dpr = window.devicePixelRatio || 1;
                detectedZoom = dpr; // nativeDPR = 1, so zoom = dpr / 1 = dpr
            } else if (window.outerWidth && window.innerWidth && window.outerWidth > 0) {
                // Chrome and other browsers: outerWidth/innerWidth works reliably
                detectedZoom = window.outerWidth / window.innerWidth;
            }

            // Clamp to reasonable values
            detectedZoom = Math.max(0.1, Math.min(10, detectedZoom));

            setZoom(detectedZoom);
        };

        updateZoom();
        window.addEventListener('resize', updateZoom);

        // Also listen to visualViewport resize if available
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateZoom);
        }

        return () => {
            window.removeEventListener('resize', updateZoom);
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', updateZoom);
            }
        };
    }, []);

    return zoom;
}

// Hook to calculate the complete layout with zoom compensation
function useStoryLayout() {
    const zoom = useZoomLevel();

    const [layout, setLayout] = useState({
        storyScale: 1,
        showNavButtons: true,
        storyWidth: CANONICAL_WIDTH,
        storyHeight: CANONICAL_HEIGHT,
        // Furniture sizes adjusted for zoom
        navButtonSize: NAV_BUTTON_SIZE_BASE,
        closeButtonSize: CLOSE_BUTTON_SIZE_BASE,
        buttonGap: BUTTON_GAP_BASE,
        closeButtonGap: CLOSE_BUTTON_GAP_BASE,
    });

    useEffect(() => {
        const updateLayout = () => {
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            // Calculate zoom-compensated furniture sizes
            // When zoom is 2x, we want buttons to be half the CSS pixels so they appear same physical size
            const navButtonSize = NAV_BUTTON_SIZE_BASE / zoom;
            const closeButtonSize = CLOSE_BUTTON_SIZE_BASE / zoom;
            const buttonGap = BUTTON_GAP_BASE / zoom;
            const closeButtonGap = CLOSE_BUTTON_GAP_BASE / zoom;
            const minMargin = MIN_MARGIN_BASE / zoom;

            // Physical viewport width (zoom-independent) for threshold check
            const physicalWidth = vw * zoom;
            const showNavButtons = physicalWidth >= NAV_BUTTON_HIDE_THRESHOLD;

            // Calculate margins (5% of viewport, minimum of zoom-adjusted margin)
            const sideMargin = Math.max(vw * 0.05, minMargin);
            const topMargin = Math.max(vh * 0.05, minMargin);
            const bottomMargin = Math.max(vh * 0.05, minMargin);

            // Space taken by furniture (in current CSS pixels)
            const navButtonSpace = showNavButtons ? (navButtonSize + buttonGap) * 2 : 0;
            const closeButtonSpace = closeButtonSize + closeButtonGap;

            // Available space for the story
            const availableWidth = Math.max(vw - sideMargin * 2 - navButtonSpace, 50);
            const availableHeight = Math.max(vh - topMargin - bottomMargin - closeButtonSpace, 50);

            // Calculate story scale to fit available space while ALWAYS maintaining aspect ratio
            const scaleX = availableWidth / CANONICAL_WIDTH;
            const scaleY = availableHeight / CANONICAL_HEIGHT;
            const storyScale = Math.max(0.1, Math.min(scaleX, scaleY)); // Clamp to prevent zero/negative

            // Final rendered story dimensions (always maintains aspect ratio)
            const storyWidth = CANONICAL_WIDTH * storyScale;
            const storyHeight = CANONICAL_HEIGHT * storyScale;

            setLayout({
                storyScale,
                showNavButtons,
                storyWidth,
                storyHeight,
                navButtonSize,
                closeButtonSize,
                buttonGap,
                closeButtonGap,
            });
        };

        updateLayout();

        // Listen to resize events
        window.addEventListener('resize', updateLayout);

        // Also use ResizeObserver for more reliable updates
        const resizeObserver = new ResizeObserver(updateLayout);
        resizeObserver.observe(document.body);

        return () => {
            window.removeEventListener('resize', updateLayout);
            resizeObserver.disconnect();
        };
    }, [zoom]);

    return layout;
}

// Animated Music Icon Component
function MusicBarsIcon({ isMuted, className }: { isMuted: boolean; className?: string }) {
    return (
        <div className={cn("flex items-end justify-center gap-[2px] h-4 w-4", className)}>
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    className="w-1 bg-current rounded-full"
                    animate={isMuted ? { height: 4 } : {
                        height: [8, 14, 8, 12, 8],
                    }}
                    transition={isMuted ? { duration: 0.2 } : {
                        duration: 0.6 + i * 0.1,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: i * 0.15,
                    }}
                    style={{ minHeight: 4 }}
                />
            ))}
        </div>
    );
}

// Ambilight Canvas Component - YouTube-style ambient glow
// CSS-based Ambilight effect that works with any DOM element
// Creates a blurred, scaled-up clone of the story behind it
function AmbilightWrapper({
    children,
    storyScale,
}: {
    children: React.ReactNode;
    storyScale: number;
}) {
    // Ambilight settings - increased for more dramatic glow
    const BLUR_AMOUNT = 100; // px - increased from 80
    const GLOW_SCALE = 1.25; // How much larger the glow is vs the story - increased from 1.15
    const GLOW_OPACITY = 0.7; // increased from 0.6
    const SATURATION_BOOST = 1.5; // increased from 1.3

    return (
        <div className="relative">
            {/* Ambilight layer - blurred clone positioned behind */}
            <div
                className="absolute pointer-events-none"
                style={{
                    inset: 0,
                    transform: `scale(${GLOW_SCALE})`,
                    filter: `blur(${BLUR_AMOUNT}px) saturate(${SATURATION_BOOST})`,
                    opacity: GLOW_OPACITY,
                    zIndex: 0,
                }}
            >
                {/* Clone of children rendered blurred behind */}
                <div style={{
                    width: CANONICAL_WIDTH,
                    height: CANONICAL_HEIGHT,
                    overflow: 'hidden',
                    borderRadius: 24,
                }}>
                    {children}
                </div>
            </div>

            {/* Actual story content on top */}
            <div style={{ position: 'relative', zIndex: 1 }}>
                {children}
            </div>
        </div>
    );
}

// --- Slides ---

interface SlideProps {
    stats: YearReviewStats;
    year: string;
    yearStartDate?: Date;
    yearEndDate?: Date;
    onClose: () => void;
    userName?: string;
    userAvatar?: string;
    t: ReturnType<typeof useTranslations<"YearReview">>;
}

// Props for the exported YearReviewStory component (t is internal)
interface YearReviewStoryProps {
    stats: YearReviewStats;
    year: string;
    yearStartDate?: Date;
    yearEndDate?: Date;
    onClose: () => void;
    userName?: string;
    userAvatar?: string;
    isOpen: boolean;
}

function CountUp({ value, duration = 2, delay = 0, decimals = 0, ease = "easeOut" }: { value: number, duration?: number, delay?: number, decimals?: number, ease?: any }) {
    const nodeRef = useRef<HTMLSpanElement>(null);
    const motionValue = useMotionValue(0);
    const rounded = useTransform(motionValue, (latest) => latest.toFixed(decimals));

    useEffect(() => {
        const controls = animate(motionValue, value, {
            duration,
            delay,
            ease
        });
        return () => controls.stop();
    }, [value, duration, delay, motionValue, ease]);

    return <motion.span>{rounded}</motion.span>;
}

function IntroSlide({ year, userName, userAvatar, t }: SlideProps) {
    return (
        <div className="relative flex flex-col items-center justify-center h-full text-center p-4 bg-[#0a0a0a] text-white overflow-hidden">
            {/* Animated gradient orbs - sized for canonical viewport */}
            <motion.div
                className="absolute top-1/4 -left-16 w-48 h-48 bg-emerald-500/30 rounded-full blur-[60px]"
                animate={{
                    x: [0, 20, 0],
                    y: [0, -15, 0],
                    scale: [1, 1.1, 1]
                }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
                className="absolute bottom-1/4 -right-16 w-56 h-56 bg-cyan-500/25 rounded-full blur-[80px]"
                animate={{
                    x: [0, -25, 0],
                    y: [0, 20, 0],
                    scale: [1, 1.2, 1]
                }}
                transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-teal-400/20 rounded-full blur-[100px]"
                animate={{
                    scale: [1, 1.3, 1],
                    opacity: [0.2, 0.35, 0.2]
                }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Content */}
            <div className="relative z-10 flex flex-col items-center">
                {/* Logo/Avatar with ring animation - sized for canonical viewport */}
                <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, type: "spring", bounce: 0.4 }}
                    className="relative mb-6"
                >
                    {/* Animated rings - positioned outside the logo box */}
                    {/* Using box-shadow instead of border for consistent rendering at different scales */}
                    <motion.div
                        className="absolute inset-0 rounded-full"
                        style={{ margin: -12, boxShadow: 'inset 0 0 0 2px rgba(52, 211, 153, 0.5)' }}
                        animate={{ scale: [1.15, 1.30, 1.15], opacity: [0.6, 0, 0.6] }}
                        transition={{ duration: 2, repeat: Infinity }}
                    />
                    <motion.div
                        className="absolute inset-0 rounded-full"
                        style={{ margin: -20, boxShadow: 'inset 0 0 0 1px rgba(34, 211, 238, 0.4)' }}
                        animate={{ scale: [1.2, 1.4, 1.2], opacity: [0.4, 0, 0.4] }}
                        transition={{ duration: 2.5, repeat: Infinity, delay: 0.3 }}
                    />
                    <motion.div
                        className="absolute inset-0 rounded-full"
                        style={{ margin: -28, boxShadow: 'inset 0 0 0 1px rgba(45, 212, 191, 0.2)' }}
                        animate={{ scale: [1.25, 1.5, 1.25], opacity: [0.2, 0, 0.2] }}
                        transition={{ duration: 3, repeat: Infinity, delay: 0.6 }}
                    />

                    {userAvatar ? (
                        <div className="w-20 h-20 rounded-xl p-1 shadow-[0_0_30px_rgba(16,185,129,0.4)]">
                            <img
                                src={userAvatar}
                                alt={userName || "User"}
                                className="w-full h-full rounded-[10px] object-cover"
                            />
                        </div>
                    ) : (
                        <div className="w-20 h-20 rounded-xl p-1 shadow-[0_0_30px_rgba(16,185,129,0.4)]">
                            <div className="w-full h-full rounded-[calc(theme(borderRadius.xl)-2px)] bg-[#0a0a0a] flex items-center justify-center overflow-hidden">
                                <img
                                    src="/logo.svg"
                                    alt="Avermate"
                                    className="w-full h-full object-contain"
                                />
                            </div>
                        </div>
                    )}
                </motion.div>

                {/* Username */}
                {userName && (
                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 0.7, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="text-base font-medium text-gray-300 mb-2"
                    >
                        {userName}
                    </motion.p>
                )}

                {/* Year - Big dramatic reveal - sized for canonical viewport */}
                <motion.h1
                    initial={{ opacity: 0, y: 30, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 0.5, duration: 0.6, type: "spring" }}
                    className="text-6xl font-black mb-3 tracking-tight bg-gradient-to-r from-emerald-300 via-cyan-300 to-teal-300 bg-clip-text text-transparent drop-shadow-[0_0_20px_rgba(16,185,129,0.5)]"
                >
                    {year}
                </motion.h1>

                {/* Subtitle */}
                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7 }}
                    className="text-xl font-bold mb-2 text-white"
                >
                    {t("intro.yearInReview")}
                </motion.h2>

                {/* Tagline */}
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.6 }}
                    transition={{ delay: 0.9 }}
                    className="text-sm text-gray-400"
                >
                    {t("intro.yourJourney")}
                </motion.p>

                {/* Tap indicator */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 0.5, y: 0 }}
                    transition={{ delay: 1.2 }}
                    className="absolute -bottom-16 flex flex-col items-center gap-2"
                >
                    <motion.div
                        animate={{ y: [0, 5, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="text-[10px] text-gray-500 uppercase tracking-widest"
                    >
                        {t("intro.tapToContinue")}
                    </motion.div>
                </motion.div>
            </div>
        </div>
    );
}

function StatsSlide({ stats, t }: SlideProps) {
    const [zoomOut, setZoomOut] = useState(false);

    // Animation values calibrated for canonical size (390x844)
    // Calculate dynamic offset to center on Grades bar
    // Layout: [GradesBar(80px)] [gap(32px)] [PointsBar(80px)]
    const SCALE = 2.8;
    const BAR_WIDTH = 80; // w-20 = 5rem = 80px
    const GAP = 32; // gap-8 = 2rem = 32px
    const distanceToGradesCenter = (GAP / 2) + (BAR_WIDTH / 2); // 56px
    const xOffset = distanceToGradesCenter * SCALE; // ~157px

    useEffect(() => {
        const timer = setTimeout(() => setZoomOut(true), 2200);
        return () => clearTimeout(timer);
    }, []);

    // Generate more speed lines for the tracking phase - spread across the whole screen
    const speedLines = useMemo(() => {
        return Array.from({ length: 24 }, (_, i) => ({
            id: i,
            left: `${(i / 24) * 100 + (Math.random() - 0.5) * 8}%`,
            delay: Math.random() * 0.8,
            duration: 0.4 + Math.random() * 0.5,
            height: 60 + Math.random() * 120,
            opacity: 0.3 + Math.random() * 0.4,
        }));
    }, []);

    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-4 bg-[#0a0a0a] text-white overflow-hidden relative">
            {/* Animated gradient background */}
            <motion.div
                className="absolute inset-0 bg-gradient-to-br from-violet-900/40 via-[#0a0a0a] to-fuchsia-900/40"
                animate={{
                    opacity: [0.5, 0.8, 0.5],
                }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Radial glow behind bars */}
            <motion.div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/4 w-[500px] h-[500px] rounded-full"
                style={{
                    background: 'radial-gradient(circle, rgba(139, 92, 246, 0.3) 0%, rgba(139, 92, 246, 0) 70%)',
                }}
                animate={zoomOut ? { scale: 1.2, opacity: 0.6 } : { scale: 0.8, opacity: 0.4 }}
                transition={{ duration: 0.8 }}
            />

            {/* Speed lines during tracking phase - behind bar chart (z-0) */}
            <AnimatePresence>
                {!zoomOut && speedLines.map((line) => (
                    <motion.div
                        key={line.id}
                        className="absolute w-[1.5px] bg-gradient-to-b from-transparent via-violet-400/60 to-transparent rounded-full z-0"
                        style={{
                            left: line.left,
                            height: line.height,
                        }}
                        initial={{ y: -150, opacity: 0 }}
                        animate={{
                            y: ['-20%', '120%'],
                            opacity: [0, line.opacity, line.opacity, 0],
                        }}
                        exit={{ opacity: 0, transition: { duration: 0.3 } }}
                        transition={{
                            duration: line.duration,
                            delay: line.delay,
                            repeat: Infinity,
                            ease: "linear",
                        }}
                    />
                ))}
            </AnimatePresence>

            <motion.div
                initial={{ scale: SCALE, y: 100, x: xOffset }}
                animate={zoomOut
                    ? { scale: 1, y: 0, x: 0 } // Zoom out to full view
                    : { scale: SCALE, y: 180, x: xOffset } // Track the growing bar upwards, keep centered on Grades
                }
                transition={zoomOut
                    ? { duration: 0.8, type: "spring", bounce: 0.2 } // Zoom out transition
                    : { duration: 2, ease: "easeOut" } // Tracking transition (matches bar growth)
                }
                className="flex items-end justify-center gap-8 h-64 w-full max-w-xs relative z-10"
            >
                {/* Grades Bar */}
                <div className="flex flex-col items-center gap-2 w-20 relative">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={zoomOut ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                        className="text-lg font-bold whitespace-nowrap absolute -top-8 text-violet-200"
                    >
                        {t("stats.grades")}
                    </motion.div>

                    <div className="relative w-full h-64 bg-[#0a0a0a] rounded-t-2xl overflow-hidden flex items-end" style={{ boxShadow: 'inset 0 0 0 1px rgba(139, 92, 246, 0.2)' }}>
                        {/* Growing Fill */}
                        <motion.div
                            initial={{ height: "0%" }}
                            animate={{ height: "60%" }}
                            transition={{ duration: 2, ease: "easeOut" }}
                            className="w-full relative"
                            style={{
                                background: 'linear-gradient(to top, #7c3aed, #a78bfa, #c4b5fd)',
                                boxShadow: '0 0 30px rgba(139, 92, 246, 0.6), 0 0 60px rgba(139, 92, 246, 0.3)',
                            }}
                        >
                            {/* Subtle shimmer effect - gentler, continues past the top */}
                            {!zoomOut && (
                                <motion.div
                                    className="absolute inset-x-0 -top-[50%] bottom-0 bg-gradient-to-t from-transparent via-white/15 to-transparent"
                                    style={{ height: '200%' }}
                                    initial={{ y: '50%' }}
                                    animate={{ y: '-100%' }}
                                    transition={{ duration: 2.2, ease: "easeOut" }}
                                />
                            )}
                            {/* Ticking Value on top of the bar */}
                            <div className="absolute -top-10 left-1/2 -translate-x-1/2 text-center w-24">
                                <span className="text-3xl font-black text-white drop-shadow-[0_0_20px_rgba(139,92,246,0.8)]">
                                    <CountUp value={stats.gradesCount} duration={2} />
                                </span>
                            </div>
                        </motion.div>
                    </div>
                </div>

                {/* Points Bar */}
                <div className="flex flex-col items-center gap-2 w-20 relative">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={zoomOut ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                        transition={{ delay: 0.1 }}
                        className="text-lg font-bold whitespace-nowrap absolute -top-8 text-fuchsia-200"
                    >
                        {t("stats.points")}
                    </motion.div>

                    <div className="relative w-full h-64 bg-[#0a0a0a] rounded-t-2xl overflow-hidden flex items-end" style={{ boxShadow: 'inset 0 0 0 1px rgba(236, 72, 153, 0.2)' }}>
                        <motion.div
                            initial={{ height: "0%" }}
                            animate={zoomOut ? { height: "75%" } : { height: "0%" }}
                            transition={{ duration: 1.5, ease: "easeOut", delay: 0.2 }}
                            className="w-full relative"
                            style={{
                                background: 'linear-gradient(to top, #db2777, #f472b6, #fbcfe8)',
                                boxShadow: '0 0 30px rgba(236, 72, 153, 0.6), 0 0 60px rgba(236, 72, 153, 0.3)',
                            }}
                        >
                            {zoomOut && (
                                <div className="absolute -top-10 left-1/2 -translate-x-1/2 text-center w-24">
                                    <span className="text-2xl font-black text-white drop-shadow-[0_0_20px_rgba(236,72,153,0.8)]">
                                        <CountUp value={stats.gradesSum} duration={1.5} delay={0.2} decimals={0} />
                                    </span>
                                </div>
                            )}
                        </motion.div>
                    </div>
                </div>
            </motion.div>

            <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={zoomOut ? { opacity: 0.6, y: 0 } : { opacity: 0, y: 20 }}
                transition={{ delay: 0.8 }}
                className="mt-8 text-sm max-w-xs mx-auto text-gray-400 relative z-10"
            >
                {t("stats.accumulatedPoints")}
            </motion.p>
        </div>
    );
}

function HeatmapSlide({ stats, year, yearStartDate, yearEndDate, userName, userAvatar, t }: SlideProps) {
    const [zoomOut, setZoomOut] = useState(false);
    const formatter = useFormatter();

    // Format the most active month using next-intl
    const formattedMostActiveMonth = useMemo(() => {
        const [yearNum, monthNum] = stats.mostActiveMonth.month.split('-').map(Number);
        const date = new Date(yearNum, monthNum - 1, 1);
        return formatter.dateTime(date, { month: 'long' });
    }, [stats.mostActiveMonth.month, formatter]);

    const days = useMemo(() => {
        const result = [];
        const now = new Date();

        // Use provided year dates or fall back to parsing year name
        let startDate: Date;
        let endDate: Date;

        if (yearStartDate && yearEndDate) {
            startDate = new Date(yearStartDate);
            // End date is either the year end date or current date, whichever is earlier
            endDate = new Date(Math.min(new Date(yearEndDate).getTime(), now.getTime()));
        } else {
            const yearNum = parseInt(year);
            const targetYear = isNaN(yearNum) ? now.getFullYear() : yearNum;
            startDate = new Date(targetYear, 0, 1);
            const isCurrentYear = now.getFullYear() === targetYear;
            endDate = isCurrentYear ? now : new Date(targetYear, 11, 31);
        }

        const currentDate = new Date(startDate);

        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const count = stats.heatmap[dateStr] || 0;
            result.push({
                date: new Date(currentDate),
                count,
                dateStr
            });
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return result;
    }, [stats.heatmap, year, yearStartDate, yearEndDate]);

    const weeks = useMemo(() => {
        const w: (typeof days[0] | null)[][] = [];
        let currentWeek: (typeof days[0] | null)[] = Array(7).fill(null);

        if (days.length > 0) {
            const firstDayOfWeek = days[0].date.getDay();
            for (let i = 0; i < firstDayOfWeek; i++) {
                currentWeek[i] = null;
            }
        }

        days.forEach((day) => {
            const dayIndex = day.date.getDay();
            currentWeek[dayIndex] = day;

            if (dayIndex === 6) {
                w.push(currentWeek);
                currentWeek = Array(7).fill(null);
            }
        });

        if (currentWeek.some(d => d !== null)) {
            w.push(currentWeek);
        }

        return w;
    }, [days]);

    // Trigger zoom out after horizontal pan completes
    useEffect(() => {
        const timer = setTimeout(() => setZoomOut(true), 1800);
        return () => clearTimeout(timer);
    }, []);

    // Generate horizontal speed lines for the pan effect
    const speedLines = useMemo(() => {
        return Array.from({ length: 18 }, (_, i) => ({
            id: i,
            top: `${(i / 18) * 100 + (Math.random() - 0.5) * 10}%`,
            delay: Math.random() * 0.6,
            duration: 0.3 + Math.random() * 0.3,
            width: 80 + Math.random() * 150,
            opacity: 0.2 + Math.random() * 0.3,
        }));
    }, []);

    // Calculate heatmap scale and container height to fit max height of 80px
    // Each cell is aspect-square, so cell height = cell width
    // Total width is container width (390 - 24 padding = 366), divided by weeks + gaps
    // Cell width ≈ 366 / weeks.length, Cell height = 7 cells * cellWidth + 6 gaps
    const { heatmapScale, heatmapHeight } = useMemo(() => {
        const MAX_HEIGHT = 100;
        const containerWidth = 390 - 24; // canonical width minus padding
        const numWeeks = weeks.length || 1;
        const cellWidth = containerWidth / numWeeks;
        const naturalHeight = 7 * cellWidth; // 7 days per week
        const scale = Math.min(1, MAX_HEIGHT / naturalHeight);
        const height = Math.min(MAX_HEIGHT, naturalHeight);
        return { heatmapScale: scale, heatmapHeight: height };
    }, [weeks.length]);

    // Animation values calibrated for canonical size (390x844)
    const SCALE = 2.5;
    // Pan positions scaled for the smaller viewport
    const START_X = 600; // Start position (first day visible on right side)
    const END_X = -350;   // End position

    return (
        <div className="flex flex-col items-center justify-center gap-8 h-full text-center p-4 bg-[#0a0a0a] text-white overflow-hidden relative">
            {/* Animated gradient background */}
            <motion.div
                className="absolute inset-0 bg-gradient-to-br from-blue-900/30 via-[#0a0a0a] to-indigo-900/30"
                animate={{
                    opacity: [0.5, 0.7, 0.5],
                }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Background Gradients - enhanced glow */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <motion.div
                    className="absolute -top-[20%] -right-[20%] w-[350px] h-[350px] bg-[#3e61d2]/15 rounded-full blur-[100px]"
                    animate={zoomOut ? { scale: 1.3, opacity: 0.2 } : { scale: 1, opacity: 0.15 }}
                    transition={{ duration: 0.8 }}
                />
                <motion.div
                    className="absolute -bottom-[20%] -left-[20%] w-[300px] h-[300px] bg-[#5e81f2]/10 rounded-full blur-[80px]"
                    animate={zoomOut ? { scale: 1.2, opacity: 0.15 } : { scale: 1, opacity: 0.1 }}
                    transition={{ duration: 0.8 }}
                />
            </div>

            {/* Horizontal speed lines during pan phase */}
            <AnimatePresence>
                {!zoomOut && speedLines.map((line) => (
                    <motion.div
                        key={line.id}
                        className="absolute h-[1.5px] bg-gradient-to-r from-transparent via-blue-400/50 to-transparent rounded-full z-0"
                        style={{
                            top: line.top,
                            width: line.width,
                        }}
                        initial={{ x: '100vw', opacity: 0 }}
                        animate={{
                            x: ['-10%', '-120%'],
                            opacity: [0, line.opacity, line.opacity, 0],
                        }}
                        exit={{ opacity: 0, transition: { duration: 0.2 } }}
                        transition={{
                            duration: line.duration,
                            delay: line.delay,
                            repeat: Infinity,
                            ease: "linear",
                        }}
                    />
                ))}
            </AnimatePresence>

            {/* Header - appears after zoom out */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={zoomOut ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
                transition={{ duration: 0.5 }}
                className="w-full relative z-10"
            >
                <div className="flex items-center justify-center gap-3">
                    {userAvatar ? (
                        <img src={userAvatar} alt={userName || ""} className="w-10 h-10 rounded-full object-cover" style={{ boxShadow: 'inset 0 0 0 2px rgba(255, 255, 255, 0.2)' }} />
                    ) : (
                        <div className="w-10 h-10 rounded-full overflow-hidden" style={{ boxShadow: 'inset 0 0 0 2px rgba(255, 255, 255, 0.2)' }}>
                            <div className="w-full h-full bg-gradient-to-br from-[#3e61d2] to-blue-500" />
                        </div>
                    )}
                    <div className="text-left">
                        {userName && <div className="font-bold text-base">{userName}</div>}
                        <div className="text-xs text-blue-300/60">{t("heatmap.yearInGrades", { year })}</div>
                    </div>
                </div>
            </motion.div>

            {/* Heatmap container with camera animation */}
            <motion.div
                initial={{ scale: SCALE, x: START_X }}
                animate={zoomOut
                    ? { scale: 1, x: 0 }
                    : { scale: SCALE, x: END_X }
                }
                transition={zoomOut
                    ? { duration: 0.5, type: "spring", bounce: 0.08 }
                    : { duration: 1.8, ease: [0.35, 0.85, 0.35, 1] } // Snappier ease-out
                }
                className="w-full bg-[#0d1117] p-3 rounded-xl relative z-10 overflow-hidden"
                style={{ boxShadow: 'inset 0 0 0 1px rgba(62, 97, 210, 0.2), 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(62, 97, 210, 0.1)' }}
            >
                {/* Subtle scan line effect during pan */}
                {!zoomOut && (
                    <motion.div
                        className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-blue-400/10 to-transparent z-10 pointer-events-none"
                        initial={{ x: '-100%' }}
                        animate={{ x: '500%' }}
                        transition={{ duration: 2.5, ease: "easeOut" }}
                    />
                )}

                <div className="w-full flex justify-center overflow-hidden" style={{ height: heatmapHeight }}>
                    <div
                        className="flex gap-[1px] w-full"
                        style={{ transform: `scale(${heatmapScale})`, transformOrigin: 'top center' }}
                    >
                        {weeks.map((week, weekIndex) => (
                            <div
                                key={weekIndex}
                                className="flex-1 flex flex-col gap-[1px]"
                            >
                                {week.map((day, dayIndex) => (
                                    <div
                                        key={`${weekIndex}-${dayIndex}`}
                                        className={cn(
                                            "w-full aspect-square rounded-[1px]",
                                            !day ? "bg-transparent" :
                                                day.count === 0 ? "bg-[#161b22]" :
                                                    day.count === 1 ? "bg-[#1d2d60]" :
                                                        day.count <= 3 ? "bg-[#2d4696]" :
                                                            "bg-[#3e61d2]"
                                        )}
                                        style={day && day.count === 0 ? { boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.03)' } :
                                            day && day.count > 3 ? { boxShadow: '0 0 4px rgba(62, 97, 210, 0.4)' } : undefined}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Grade count - appears after zoom out */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={zoomOut ? { opacity: 1 } : { opacity: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-left mt-3 text-xs text-[#8b949e] w-full"
                >
                    {t("heatmap.gradesInYear", { count: stats.gradesCount, year })}
                </motion.div>
            </motion.div>

            {/* Most Active Month - appears after zoom out */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={zoomOut ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                transition={{ delay: 0.4, duration: 0.5 }}
                className="w-full relative z-10"
            >
                <h3 className="text-base text-[#8b949e] mb-2">{t("heatmap.mostActiveMonth")}</h3>
                <div className="text-4xl font-black uppercase tracking-wider bg-gradient-to-r from-[#3e61d2] via-[#5e81f2] to-[#3e61d2] bg-clip-text text-transparent drop-shadow-[0_0_20px_rgba(62,97,210,0.4)]">
                    {formattedMostActiveMonth}
                </div>
                <p className="text-sm mt-2 text-[#8b949e]">{t("heatmap.gradesEntered", { count: stats.mostActiveMonth.count })}</p>
            </motion.div>
        </div>
    );
}

function StreakSlide({ stats, t }: SlideProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-black text-white relative overflow-hidden">
            {/* LightPillar effect */}
            <LightPillar
                topColor="#cc8800"
                bottomColor="#5a2800"
                intensity={1.8}
                rotationSpeed={1}
                glowAmount={0.0015}
                pillarWidth={3}
                pillarHeight={0.4}
                noiseIntensity={0.5}
                pillarRotation={45}
                mixBlendMode="screen"
            />

            {/* Dark vignette overlay for better text contrast */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/50 pointer-events-none z-[1]" />

            <div className="relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500/20 rounded-full text-orange-300 mb-8 backdrop-blur-sm"
                    style={{ boxShadow: 'inset 0 0 0 1px rgba(249, 115, 22, 0.4)' }}
                >
                    <div className="text-lg">🔥</div>
                    <span className="font-bold text-sm uppercase tracking-wider">{t("streak.onFire")}</span>
                </motion.div>

                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-3xl font-bold mb-4 drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]"
                >
                    {t("streak.longestStreak")}
                </motion.h2>

                <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 200, delay: 0.4 }}
                    className="text-[12rem] leading-none font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 via-orange-500 to-red-600 drop-shadow-[0_0_50px_rgba(234,88,12,0.5)]"
                >
                    <CountUp value={stats.longestStreak} duration={1.5} delay={0.5} ease="circOut" />
                </motion.div>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8 }}
                    className="mt-8 text-xl opacity-80 max-w-xs mx-auto drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
                >
                    {t("streak.consecutiveGrades")}
                </motion.p>
            </div>
        </div>
    );
}

function PrimeTimeSlide({ stats, t }: SlideProps) {
    const [phase, setPhase] = useState<'tracing' | 'peak' | 'reveal'>('tracing');
    const [progress, setProgress] = useState(0);
    const pathRef = useRef<SVGPathElement>(null);
    const formatter = useFormatter();
    const date = formatter.dateTime(new Date(stats.primeTime.date), { day: 'numeric', month: 'long' });

    // Generate smoother line chart data
    const chartData = useMemo(() => {
        const points: { x: number; y: number }[] = [
            { x: 0, y: 15 },
            { x: 8, y: 22 },
            { x: 16, y: 18 },
            { x: 24, y: 35 },
            { x: 32, y: 28 },
            { x: 40, y: 45 },
            { x: 48, y: 42 },
            { x: 56, y: 58 },
            { x: 64, y: 52 },
            { x: 72, y: 70 },
            { x: 80, y: 90 }, // Peak
            { x: 88, y: 78 },
            { x: 100, y: 72 },
        ];
        const peakIndex = 10;
        // Peak is at index 10 out of 13 points - adjusted to land exactly on peak
        const peakProgress = 0.840;
        return { points, peakIndex, peakProgress };
    }, []);

    // Create smooth SVG path using cubic bezier curves
    const pathD = useMemo(() => {
        const { points } = chartData;
        if (points.length < 2) return '';

        let d = `M ${points[0].x} ${100 - points[0].y}`;

        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(points.length - 1, i + 2)];

            // Catmull-Rom to Bezier conversion
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;

            d += ` C ${cp1x} ${100 - cp1y}, ${cp2x} ${100 - cp2y}, ${p2.x} ${100 - p2.y}`;
        }

        return d;
    }, [chartData]);

    // Get point position along path at given progress (0-1)
    const getPointAtProgress = useCallback((prog: number) => {
        if (!pathRef.current) return { x: 0, y: 50 };
        const pathLength = pathRef.current.getTotalLength();
        const point = pathRef.current.getPointAtLength(prog * pathLength);
        return { x: point.x, y: point.y };
    }, []);

    const { points, peakIndex, peakProgress } = chartData;
    const peakPoint = points[peakIndex];

    // Animate progress for tracing phase
    useEffect(() => {
        if (phase !== 'tracing') return;

        const duration = 2500;
        const startTime = performance.now();

        const animateProgress = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const t = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - t, 3);
            setProgress(eased * peakProgress);

            if (t < 1) {
                requestAnimationFrame(animateProgress);
            }
        };

        requestAnimationFrame(animateProgress);
    }, [phase, peakProgress]);

    // Animation timeline
    useEffect(() => {
        const peakTimer = setTimeout(() => setPhase('peak'), 2500);
        const revealTimer = setTimeout(() => setPhase('reveal'), 3200);

        return () => {
            clearTimeout(peakTimer);
            clearTimeout(revealTimer);
        };
    }, []);

    // Calculate current dot position
    const currentProgress = phase === 'tracing' ? progress : peakProgress;
    const currentDotPos = getPointAtProgress(currentProgress);

    // Camera follows dot during tracing - calculate offset to keep dot centered
    const cameraX = phase === 'reveal' ? 0 : -(currentDotPos.x - 50) * 7;
    const cameraY = phase === 'reveal' ? 0 : -(currentDotPos.y - 50) * 2;

    return (
        <div className="flex flex-col items-center justify-center h-full text-center bg-[#0a0a0a] text-white relative overflow-hidden">
            {/* Animated background gradient */}
            <motion.div
                className="absolute inset-0 bg-gradient-to-br from-emerald-900/20 via-[#0a0a0a] to-green-900/20"
                animate={phase === 'reveal' ? { opacity: 0.8 } : { opacity: 0.4 }}
                transition={{ duration: 0.8 }}
            />

            {/* Background glow that intensifies at peak */}
            <motion.div
                className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-emerald-500/20 rounded-full blur-[100px]"
                animate={
                    phase === 'peak' ? { scale: 1.5, opacity: 0.6 } :
                        phase === 'reveal' ? { scale: 2, opacity: 0.3, y: -50 } :
                            { scale: 1, opacity: 0.1 }
                }
                transition={{ duration: 0.5 }}
            />

            {/* Chart container - camera follows dot, then zooms out */}
            <motion.div
                className="relative w-full flex-1 flex items-center justify-center"
                animate={{
                    scale: phase === 'reveal' ? 1 : 2.8,
                    x: cameraX,
                    y: phase === 'reveal' ? 0 : cameraY + 80,
                }}
                transition={phase === 'reveal' ? {
                    duration: 0.7,
                    type: "spring",
                    bounce: 0.12
                } : {
                    duration: 0.1,
                    ease: "linear"
                }}
            >
                <div className="w-full h-[200px] relative">
                    {/* Grid lines */}
                    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                        {[20, 40, 60, 80].map((y) => (
                            <motion.line
                                key={y}
                                x1="0" y1={y} x2="100" y2={y}
                                stroke="rgba(255,255,255,0.05)"
                                strokeWidth="0.3"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: phase === 'reveal' ? 1 : 0.3 }}
                            />
                        ))}
                    </svg>

                    {/* Main chart SVG */}
                    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="chartGradientPrime" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                            </linearGradient>
                            <linearGradient id="lineGradientPrime" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#16a34a" />
                                <stop offset="100%" stopColor="#4ade80" />
                            </linearGradient>
                            <filter id="lineGlow" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="1" result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>

                        {/* Hidden path for measuring */}
                        <path
                            ref={pathRef}
                            d={pathD}
                            fill="none"
                            stroke="transparent"
                        />

                        {/* Area fill under line */}
                        <motion.path
                            d={`${pathD} L 100 100 L 0 100 Z`}
                            fill="url(#chartGradientPrime)"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: phase !== 'tracing' ? 0.5 : 0.2 }}
                            transition={{ duration: 0.5 }}
                        />

                        {/* The line with draw animation - matches dot position exactly */}
                        <motion.path
                            d={pathD}
                            fill="none"
                            stroke="url(#lineGradientPrime)"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            filter="url(#lineGlow)"
                            style={{ pathLength: 0 }}
                            initial={{ pathLength: 0, opacity: 0 }}
                            animate={{
                                pathLength: phase === 'tracing' ? progress : (phase === 'peak' ? peakProgress : 1),
                                opacity: 1
                            }}
                            transition={{
                                pathLength: { duration: phase === 'reveal' ? 0.3 : 0, ease: "linear" },
                                opacity: { duration: 0.1, delay: 0.05 }
                            }}
                        />
                    </svg>

                    {/* Glowing dot - positioned via DOM for proper following */}
                    <motion.div
                        className="absolute w-3 h-3 -ml-1.5 -mt-1.5 pointer-events-none z-10"
                        style={{
                            left: `${currentDotPos.x}%`,
                            top: `${currentDotPos.y}%`,
                        }}
                    >
                        <div
                            className="w-full h-full rounded-full bg-emerald-400"
                            style={{ boxShadow: '0 0 12px 4px rgba(74, 222, 128, 0.6)' }}
                        />
                    </motion.div>

                    {/* Radar-style pulse rings - at dot position, infinite during reveal */}
                    {(phase === 'peak' || phase === 'reveal') && (
                        <div
                            className="absolute w-3 h-3 -ml-1.5 -mt-1.5 pointer-events-none z-0"
                            style={{
                                left: `${peakPoint.x}%`,
                                top: `${100 - peakPoint.y}%`,
                                willChange: 'transform, opacity',
                            }}
                        >
                            <motion.div
                                className="absolute inset-0 rounded-full border-2 border-emerald-400/80"
                                style={{
                                    opacity: 0,
                                    scale: 1,
                                    willChange: 'transform, opacity',
                                    backfaceVisibility: 'hidden',
                                    transform: 'translateZ(0)',
                                }}
                                animate={{ scale: 5, opacity: [0, 0.8, 0] }}
                                transition={{
                                    duration: 1.2,
                                    repeat: Infinity,
                                    ease: "easeOut",
                                    times: [0, 0.1, 1],
                                }}
                            />
                            <motion.div
                                className="absolute inset-0 rounded-full border border-emerald-400/60"
                                style={{
                                    opacity: 0,
                                    scale: 1,
                                    willChange: 'transform, opacity',
                                    backfaceVisibility: 'hidden',
                                    transform: 'translateZ(0)',
                                }}
                                animate={{ scale: 5, opacity: [0, 0.6, 0] }}
                                transition={{
                                    duration: 1.2,
                                    repeat: Infinity,
                                    ease: "easeOut",
                                    delay: 0.4,
                                    times: [0, 0.1, 1],
                                }}
                            />
                        </div>
                    )}

                    {/* Peak marker */}
                    <motion.div
                        className="absolute pointer-events-none"
                        style={{
                            left: `${peakPoint.x}%`,
                            top: `${100 - peakPoint.y}%`,
                        }}
                        initial={{ opacity: 0, scale: 0, y: 0 }}
                        animate={phase === 'reveal' ? { opacity: 1, scale: 1, y: -50 } : { opacity: 0, scale: 0, y: 0 }}
                        transition={{ delay: 0.3, type: "spring", bounce: 0.4 }}
                    >
                        <div
                            className="whitespace-nowrap bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded-md -translate-x-1/2"
                            style={{ boxShadow: '0 0 20px rgba(34, 197, 94, 0.5)' }}
                        >
                            {t("primeTime.peak")}
                        </div>
                    </motion.div>
                </div>
            </motion.div>

            {/* Stats reveal section */}
            <motion.div
                className="relative z-10 w-full px-4 pb-4"
                initial={{ opacity: 0, y: 40 }}
                animate={phase === 'reveal' ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
                transition={{ delay: 0.2, duration: 0.5 }}
            >
                <h2 className="text-lg font-medium text-emerald-400/80 mb-2">{t("primeTime.title")}</h2>

                <div className="flex items-baseline justify-center gap-1 mb-3">
                    <span className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-green-300 drop-shadow-[0_0_30px_rgba(34,197,94,0.5)]">
                        {stats.primeTime.value.toFixed(2)}
                    </span>
                    <span className="text-xl text-emerald-400/60">/20</span>
                </div>

                <p className="text-sm text-zinc-400">
                    {t.rich("primeTime.peakReachedOn", {
                        date: (chunks) => <span className="text-emerald-400 font-semibold">{date}</span>
                    })}
                </p>
            </motion.div>
        </div>
    );
}

function SubjectsSlide({ stats, t }: SlideProps) {
    const [phase, setPhase] = useState<'anticipation' | 'reveal3' | 'reveal2' | 'reveal1' | 'complete'>('anticipation');

    // Animation timeline: staggered reveal from #3 to #1
    useEffect(() => {
        const timers = [
            setTimeout(() => setPhase('reveal3'), 400),
            setTimeout(() => setPhase('reveal2'), 1000),
            setTimeout(() => setPhase('reveal1'), 1600),
            setTimeout(() => setPhase('complete'), 2400),
        ];
        return () => timers.forEach(clearTimeout);
    }, []);

    const subjects = stats.bestSubjects.slice(0, 3);
    const hasProgression = stats.bestProgression.value > 0;

    // Podium heights for visual hierarchy
    const podiumHeights = [140, 180, 110]; // #2, #1, #3

    return (
        <div className="flex flex-col items-center justify-center h-full text-center bg-[#0a0a0a] text-white relative overflow-hidden">
            {/* Animated background */}
            <motion.div
                className="absolute inset-0 bg-gradient-to-br from-amber-900/20 via-[#0a0a0a] to-orange-900/20"
                animate={{ opacity: [0.4, 0.6, 0.4] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Spotlight effect on #1 position */}
            <motion.div
                className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[500px]"
                style={{
                    background: 'radial-gradient(ellipse at top, rgba(251, 191, 36, 0.12) 0%, transparent 60%)',
                }}
                initial={{ opacity: 0, scaleY: 0 }}
                animate={phase === 'reveal1' || phase === 'complete' ? { opacity: 1, scaleY: 1 } : { opacity: 0, scaleY: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
            />

            {/* Title */}
            <motion.div
                initial={{ opacity: 0, y: -30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.5 }}
                className="relative z-10 mb-6"
            >
                <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-300">
                    {t("subjects.topSubjects")}
                </h2>
                <p className="text-sm text-zinc-500 mt-1">{t("subjects.yourPodium")}</p>
            </motion.div>

            {/* Podium container */}
            <div className="relative z-10 flex items-end justify-center gap-2 w-full px-4 max-w-[360px]" style={{ height: '320px' }}>
                {/* #2 - Left podium */}
                <div className="flex flex-col items-center" style={{ width: '30%' }}>
                    <AnimatePresence>
                        {(phase === 'reveal2' || phase === 'reveal1' || phase === 'complete') && subjects[1] && (
                            <motion.div
                                initial={{ opacity: 0, y: 30, scale: 0.8 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ type: "spring", bounce: 0.4, duration: 0.8 }}
                                className="mb-2 text-center w-full"
                            >
                                <div className="text-3xl font-black text-zinc-400 mb-1">2</div>
                                <div className="text-xs font-semibold text-zinc-400 truncate px-1 w-full">
                                    {subjects[1].name}
                                </div>
                                <motion.div
                                    className="text-base font-bold text-zinc-300"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.3 }}
                                >
                                    {subjects[1].value.toFixed(2)}
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <motion.div
                        className="w-full rounded-t-lg bg-gradient-to-t from-zinc-700 to-zinc-600"
                        initial={{ height: 0 }}
                        animate={{ height: phase !== 'anticipation' && phase !== 'reveal3' ? podiumHeights[0] : 0 }}
                        transition={{ type: "spring", bounce: 0.3, duration: 0.8 }}
                        style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), 0 0 20px rgba(161, 161, 170, 0.1)' }}
                    />
                </div>

                {/* #1 - Center podium (tallest) */}
                <div className="flex flex-col items-center" style={{ width: '36%' }}>
                    <AnimatePresence>
                        {(phase === 'reveal1' || phase === 'complete') && subjects[0] && (
                            <motion.div
                                initial={{ opacity: 0, y: 30, scale: 0.8 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ type: "spring", bounce: 0.4, duration: 0.8 }}
                                className="mb-2 text-center w-full"
                            >
                                {/* Crown */}
                                <motion.div
                                    initial={{ opacity: 0, y: -20, rotate: -10 }}
                                    animate={{ opacity: 1, y: 0, rotate: 0 }}
                                    transition={{ delay: 0.3, type: "spring", bounce: 0.5 }}
                                    className="text-2xl"
                                >
                                    👑
                                </motion.div>
                                <div className="text-4xl font-black text-amber-400" style={{ textShadow: '0 0 20px rgba(251, 191, 36, 0.5)' }}>1</div>
                                <div className="text-sm font-bold text-white truncate px-1 w-full">
                                    {subjects[0].name}
                                </div>
                                <motion.div
                                    className="text-lg font-black text-amber-400"
                                    initial={{ opacity: 0, scale: 0 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: 0.4, type: "spring" }}
                                    style={{ textShadow: '0 0 15px rgba(251, 191, 36, 0.4)' }}
                                >
                                    {subjects[0].value.toFixed(2)}
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <motion.div
                        className="w-full rounded-t-lg bg-gradient-to-t from-amber-600 to-amber-500"
                        initial={{ height: 0 }}
                        animate={{ height: phase === 'reveal1' || phase === 'complete' ? podiumHeights[1] : 0 }}
                        transition={{ type: "spring", bounce: 0.3, duration: 0.8 }}
                        style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 0 40px rgba(251, 191, 36, 0.3)' }}
                    />
                </div>

                {/* #3 - Right podium */}
                <div className="flex flex-col items-center" style={{ width: '30%' }}>
                    <AnimatePresence>
                        {(phase !== 'anticipation') && subjects[2] && (
                            <motion.div
                                initial={{ opacity: 0, y: 30, scale: 0.8 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ type: "spring", bounce: 0.4, duration: 0.8 }}
                                className="mb-2 text-center w-full"
                            >
                                <div className="text-2xl font-black text-orange-400 mb-1">3</div>
                                <div className="text-xs font-semibold text-zinc-400 truncate px-1 w-full">
                                    {subjects[2].name}
                                </div>
                                <motion.div
                                    className="text-base font-bold text-orange-400"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.3 }}
                                >
                                    {subjects[2].value.toFixed(2)}
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <motion.div
                        className="w-full rounded-t-lg bg-gradient-to-t from-orange-800 to-orange-700"
                        initial={{ height: 0 }}
                        animate={{ height: phase !== 'anticipation' ? podiumHeights[2] : 0 }}
                        transition={{ type: "spring", bounce: 0.3, duration: 0.8 }}
                        style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 0 20px rgba(234, 88, 12, 0.15)' }}
                    />
                </div>
            </div>

            {/* Best Progression - appears last */}
            {hasProgression && (
                <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={phase === 'complete' ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 20, scale: 0.95 }}
                    transition={{ delay: 0.3, duration: 0.5, ease: "easeOut" }}
                    className="relative z-10 mt-8 flex items-center gap-3 px-4"
                >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shrink-0">
                        <TrendingUp className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-left flex-1 min-w-0">
                        <div className="text-xs text-zinc-500 mb-0.5">{t("subjects.bestComeback")}</div>
                        <div className="font-semibold text-white truncate">{stats.bestProgression.subject}</div>
                    </div>
                    <div className="text-lg font-bold text-emerald-400 shrink-0">
                        +{stats.bestProgression.value.toFixed(2)}
                    </div>
                </motion.div>
            )}
        </div>
    );
}

function PercentileSlide({ stats, t }: SlideProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const confettiInstanceRef = useRef<ReturnType<typeof confetti.create> | null>(null);
    const [phase, setPhase] = useState<'inspiral' | 'explode' | 'revealed'>('inspiral');
    const [orb1Pos, setOrb1Pos] = useState({ x: 0, y: 0 });
    const [orb2Pos, setOrb2Pos] = useState({ x: 0, y: 0 });
    const [orbRadius, setOrbRadius] = useState(80);
    const animationRef = useRef<number | null>(null);
    const startTimeRef = useRef<number | null>(null);

    // Neutron star inspiral animation - accelerating spiral inward
    useEffect(() => {
        if (phase !== 'inspiral') return;

        const TOTAL_DURATION = 1000; // Total inspiral time (1 second)
        const INITIAL_RADIUS = 90;
        const FINAL_RADIUS = 5;
        const INITIAL_SPEED = 4; // rotations per second at start
        const FINAL_SPEED = 18; // rotations per second at end

        const animateInspiral = (timestamp: number) => {
            if (!startTimeRef.current) startTimeRef.current = timestamp;
            const elapsed = timestamp - startTimeRef.current;
            const progress = Math.min(elapsed / TOTAL_DURATION, 1);

            // Exponential decay for radius - gets tighter faster near the end
            const radiusProgress = Math.pow(progress, 1.5);
            const currentRadius = INITIAL_RADIUS - (INITIAL_RADIUS - FINAL_RADIUS) * radiusProgress;
            setOrbRadius(currentRadius);

            // Exponential increase in rotation speed
            const speedProgress = Math.pow(progress, 2);
            const currentSpeed = INITIAL_SPEED + (FINAL_SPEED - INITIAL_SPEED) * speedProgress;

            // Calculate angle - integral of speed over time for smooth acceleration
            const baseRotations = INITIAL_SPEED * (elapsed / 1000);
            const acceleratedRotations = (FINAL_SPEED - INITIAL_SPEED) * Math.pow(progress, 3) * (elapsed / 1000) / 3;
            const angle = (baseRotations + acceleratedRotations) * Math.PI * 2;

            // Orb 1 position (180 degrees offset from orb 2)
            setOrb1Pos({
                x: Math.cos(angle) * currentRadius,
                y: Math.sin(angle) * currentRadius,
            });

            // Orb 2 position (opposite side)
            setOrb2Pos({
                x: Math.cos(angle + Math.PI) * currentRadius,
                y: Math.sin(angle + Math.PI) * currentRadius,
            });

            if (progress < 1) {
                animationRef.current = requestAnimationFrame(animateInspiral);
            }
        };

        animationRef.current = requestAnimationFrame(animateInspiral);

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [phase]);

    // Phase timeline
    useEffect(() => {
        const timers = [
            setTimeout(() => setPhase('explode'), 1000),
            setTimeout(() => setPhase('revealed'), 1300),
        ];
        return () => timers.forEach(clearTimeout);
    }, []);

    // Create confetti instance
    useEffect(() => {
        if (canvasRef.current && !confettiInstanceRef.current) {
            confettiInstanceRef.current = confetti.create(canvasRef.current, {
                resize: false,
                useWorker: true,
            });
        }
        return () => {
            if (confettiInstanceRef.current) {
                confettiInstanceRef.current.reset();
            }
        };
    }, []);

    // Fire confetti on explosion - kilonova style burst
    useEffect(() => {
        if (phase === 'explode' && confettiInstanceRef.current) {
            // Main kilonova explosion - bright burst
            confettiInstanceRef.current({
                particleCount: 120,
                spread: 360,
                origin: { x: 0.5, y: 0.45 },
                colors: ['#fbbf24', '#f59e0b', '#ffffff', '#a855f7', '#6366f1', '#ec4899', '#22d3ee'],
                startVelocity: 50,
                gravity: 0.8,
                scalar: 1.2,
            });
            // Secondary ring burst
            setTimeout(() => {
                confettiInstanceRef.current?.({
                    particleCount: 80,
                    spread: 360,
                    origin: { x: 0.5, y: 0.45 },
                    colors: ['#fbbf24', '#ffffff', '#f97316'],
                    startVelocity: 35,
                    gravity: 0.6,
                });
            }, 80);
            // Final sparkle
            setTimeout(() => {
                confettiInstanceRef.current?.({
                    particleCount: 40,
                    spread: 180,
                    origin: { x: 0.5, y: 0.45 },
                    colors: ['#ffffff', '#fef3c7'],
                    startVelocity: 25,
                });
            }, 200);
        }
    }, [phase]);

    // Orb scale shrinks as they spiral in
    const orbScale = Math.max(0.4, orbRadius / 90);

    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-4 bg-[#0a0a0a] text-white relative overflow-hidden">
            {/* Confetti canvas */}
            <canvas
                ref={canvasRef}
                width={CANONICAL_WIDTH}
                height={CANONICAL_HEIGHT}
                className="absolute inset-0 pointer-events-none z-30"
                style={{ width: '100%', height: '100%' }}
            />

            {/* Dark ambient background */}
            <div className="absolute inset-0 bg-gradient-to-br from-purple-950/30 via-[#0a0a0a] to-indigo-950/30" />

            {/* Gravitational wave ripples during inspiral */}
            {phase === 'inspiral' && (
                <>
                    <motion.div
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-purple-500/20"
                        style={{ width: orbRadius * 3, height: orbRadius * 3 }}
                        animate={{ scale: [1, 2, 1], opacity: [0.3, 0, 0.3] }}
                        transition={{ duration: 0.3, repeat: Infinity, ease: "linear" }}
                    />
                    <motion.div
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-500/15"
                        style={{ width: orbRadius * 4, height: orbRadius * 4 }}
                        animate={{ scale: [1, 2.5, 1], opacity: [0.2, 0, 0.2] }}
                        transition={{ duration: 0.4, repeat: Infinity, ease: "linear", delay: 0.1 }}
                    />
                </>
            )}

            {/* Orb container - centered */}
            <div className="absolute inset-0 flex items-center justify-center" style={{ top: '-10%' }}>
                {/* Orb 1 - Purple/Pink */}
                {phase === 'inspiral' && (
                    <motion.div
                        className="absolute rounded-full"
                        style={{
                            width: 100 * orbScale,
                            height: 100 * orbScale,
                            background: 'radial-gradient(circle at 30% 30%, rgba(168, 85, 247, 0.9), rgba(236, 72, 153, 0.7), transparent 70%)',
                            filter: `blur(${12 * orbScale}px)`,
                            x: orb1Pos.x,
                            y: orb1Pos.y,
                        }}
                    />
                )}

                {/* Orb 2 - Blue/Cyan */}
                {phase === 'inspiral' && (
                    <motion.div
                        className="absolute rounded-full"
                        style={{
                            width: 100 * orbScale,
                            height: 100 * orbScale,
                            background: 'radial-gradient(circle at 30% 30%, rgba(99, 102, 241, 0.9), rgba(34, 211, 238, 0.7), transparent 70%)',
                            filter: `blur(${12 * orbScale}px)`,
                            x: orb2Pos.x,
                            y: orb2Pos.y,
                        }}
                    />
                )}

                {/* Trail effect - fading afterimages */}
                {phase === 'inspiral' && orbRadius > 20 && (
                    <>
                        <div
                            className="absolute rounded-full opacity-30"
                            style={{
                                width: 80 * orbScale,
                                height: 80 * orbScale,
                                background: 'radial-gradient(circle, rgba(168, 85, 247, 0.5), transparent 70%)',
                                filter: `blur(${15 * orbScale}px)`,
                                transform: `translate(${orb1Pos.x * 0.85}px, ${orb1Pos.y * 0.85}px)`,
                            }}
                        />
                        <div
                            className="absolute rounded-full opacity-30"
                            style={{
                                width: 80 * orbScale,
                                height: 80 * orbScale,
                                background: 'radial-gradient(circle, rgba(99, 102, 241, 0.5), transparent 70%)',
                                filter: `blur(${15 * orbScale}px)`,
                                transform: `translate(${orb2Pos.x * 0.85}px, ${orb2Pos.y * 0.85}px)`,
                            }}
                        />
                    </>
                )}

                {/* Kilonova explosion flash */}
                <motion.div
                    className="absolute rounded-full"
                    style={{
                        width: 300,
                        height: 300,
                        background: 'radial-gradient(circle, rgba(255, 255, 255, 1) 0%, rgba(251, 191, 36, 0.8) 20%, rgba(249, 115, 22, 0.5) 40%, transparent 70%)',
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={phase === 'explode' || phase === 'revealed' ? {
                        scale: [0, 2.5, 0],
                        opacity: [0, 1, 0]
                    } : { scale: 0, opacity: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                />

                {/* Secondary shockwave ring */}
                <motion.div
                    className="absolute rounded-full"
                    style={{
                        width: 100,
                        height: 100,
                        border: '3px solid rgba(251, 191, 36, 0.8)',
                        background: 'transparent',
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={phase === 'explode' || phase === 'revealed' ? {
                        scale: [0, 5],
                        opacity: [1, 0]
                    } : { scale: 0, opacity: 0 }}
                    transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
                />
            </div>

            {/* Content - revealed after explosion */}
            <div className="relative z-20">
                <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={phase === 'revealed' ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-yellow-500/20 rounded-full text-yellow-300 mb-4"
                    style={{ boxShadow: 'inset 0 0 0 1px rgba(234, 179, 8, 0.4)' }}
                >
                    <Trophy className="w-3 h-3" />
                    <span className="font-bold text-xs uppercase tracking-wider">{t("percentile.legendaryStatus")}</span>
                </motion.div>

                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    animate={phase === 'revealed' ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                    transition={{ delay: 0.1 }}
                    className="text-2xl font-bold mb-2"
                >
                    {t("percentile.youAreInTheTop")}
                </motion.h2>

                <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={phase === 'revealed' ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.15 }}
                    className="text-[8rem] leading-none font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-700"
                    style={{ textShadow: '0 0 60px rgba(251, 191, 36, 0.5)' }}
                >
                    {stats.topPercentile}%
                </motion.div>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={phase === 'revealed' ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                    transition={{ delay: 0.3 }}
                    className="mt-4 text-base text-zinc-400 max-w-[280px] mx-auto"
                >
                    {t("percentile.mostActiveStudents")}
                </motion.p>
            </div>

            {/* Ambient glow after reveal */}
            <motion.div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: 'radial-gradient(circle at 50% 40%, rgba(251, 191, 36, 0.15) 0%, transparent 50%)',
                }}
                initial={{ opacity: 0 }}
                animate={phase === 'revealed' ? { opacity: 1 } : { opacity: 0 }}
                transition={{ duration: 0.5 }}
            />
        </div>
    );
}

// Stats Card Component - sized for canonical 390x844 viewport
// Using box-shadow instead of border for consistent rendering at different scales
function StatCard({ icon: Icon, title, value, colorClass, truncate = false, className, ...props }: { icon: any, title: string, value: string | number, colorClass: string, truncate?: boolean, className?: string } & React.ComponentProps<typeof motion.div>) {
    return (
        <motion.div
            className={cn("bg-[#161b22] rounded-lg p-2.5 flex flex-col items-start h-full", className)}
            style={{
                boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
            }}
            {...props}
        >
            <div className="flex items-center gap-1.5 mb-0.5">
                <Icon className={cn("w-3 h-3", colorClass)} />
                <span className="text-[10px] text-gray-400 font-medium">{title}</span>
            </div>
            <div className={cn(
                "text-2xl font-bold my-auto text-left leading-[0.9] capitalize",
                colorClass,
                truncate && "line-clamp-2 w-full break-words"
            )}>
                {value}
            </div>
        </motion.div>
    );
}

const awardIcons: Record<string, any> = {
    "Scale": Scale,
    "RefreshCcw": RefreshCcw,
    "Dices": Dices,
    "Crown": Crown,
    "Shuffle": Shuffle,
    "Crosshair": Crosshair,
    "Gem": Gem,
    "UserCheck": UserCheck,
    "Plane": Plane
};

// Awards data map - keyed by award type from API
const AWARDS: Record<AwardType, AwardData> = {
    tourist: {
        title: "Le Touriste",
        icon: "Plane",
        description: "Tu as vu de la lumière, tu es rentré, tu as mis quelques notes et tu es reparti. On ne sait pas si c'est de la confiance absolue ou du talent, mais on adore l'audace.",
        condition: "Moins de 15 notes ajoutées",
        color: "text-pink-400",
        bg: "bg-pink-500/10 border-pink-500/20",
        gradient: "from-pink-400 to-rose-400"
    },
    tightrope: {
        title: "Le Funambule",
        icon: "Scale",
        description: "Tu as marché sur un fil toute l'année, le vide à gauche, le vide à droite... mais tu n'es jamais tombé. L'art de l'équilibre, le vrai.",
        condition: "Moyenne entre 10 et 11",
        color: "text-orange-400",
        bg: "bg-orange-500/10 border-orange-500/20",
        gradient: "from-orange-500 to-amber-500"
    },
    comeback: {
        title: "Le Roi du Comeback",
        icon: "RefreshCcw",
        description: "Le début de saison était compliqué. On a eu peur. Et puis tu as enclenché la seconde et tu as doublé tout le monde avant la ligne d'arrivée.",
        condition: "+2 pts vs début d'année",
        color: "text-emerald-400",
        bg: "bg-emerald-500/10 border-emerald-500/20",
        gradient: "from-emerald-500 to-green-500"
    },
    allin: {
        title: "Le \"All In\"",
        icon: "Dices",
        description: "Pourquoi essayer d'être moyen partout quand on peut tout miser sur ses points forts ? Une stratégie risquée, mais payante.",
        condition: "+5 pts d'écart entre les matières",
        color: "text-red-400",
        bg: "bg-red-500/10 border-red-500/20",
        gradient: "from-red-500 to-rose-500"
    },
    masterclass: {
        title: "La Masterclass",
        icon: "Crown",
        description: "Félicitations. Tu as plié l'année scolaire avec une facilité déconcertante.",
        condition: "Moyenne générale > 15",
        color: "text-yellow-400",
        bg: "bg-yellow-500/10 border-yellow-500/20",
        gradient: "from-yellow-400 to-amber-400"
    },
    unpredictable: {
        title: "L'Imprévisible",
        icon: "Shuffle",
        description: "Capable du génie absolu comme du ratage total au sein d'une même matière. Avec toi, c'est tout ou rien.",
        condition: "Notes très variables",
        color: "text-purple-400",
        bg: "bg-purple-500/10 border-purple-500/20",
        gradient: "from-purple-500 to-violet-500"
    },
    precision: {
        title: "La Précision",
        icon: "Crosshair",
        description: "Une régularité chirurgicale. Quand tu vises une note, tu l'atteins à chaque fois. Pas de mauvaises surprises, tu es une valeur sûre.",
        condition: "Notes très régulières",
        color: "text-blue-400",
        bg: "bg-blue-500/10 border-blue-500/20",
        gradient: "from-blue-400 to-cyan-400"
    },
    legend: {
        title: "Légende d'Avermate",
        icon: "Gem",
        description: "Ton suivi est tellement complet que tu connais ta moyenne mieux que tes profs. Tu ne fais plus qu'un avec l'application.",
        condition: "Plus de 40 notes",
        color: "text-cyan-400",
        bg: "bg-cyan-500/10 border-cyan-500/20",
        gradient: "from-cyan-400 to-sky-400"
    },
    avermatien: {
        title: "Avermatien",
        icon: "UserCheck",
        description: "Utilisateur certifié d'Avermate. Ni trop, ni trop peu. Tu gères ton année avec le sérieux d'un comptable. C'est carré.",
        condition: "Plus de 15 notes",
        color: "text-green-400",
        bg: "bg-green-500/10 border-green-500/20",
        gradient: "from-green-400 to-emerald-400"
    }
};

// Helper to get award data from award type
function getAward(awardType: AwardType): AwardData {
    return AWARDS[awardType] || AWARDS.tourist;
}

function AwardIntroSlide({ stats, t }: SlideProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-black text-white relative overflow-hidden">
            {/* Shiny Gold Background */}
            <div className="absolute inset-0 bg-gradient-to-tr from-yellow-400/50 via-black to-yellow-400/50" />

            <div className="relative z-10 max-w-md space-y-8">
                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="text-2xl font-light text-gray-400"
                >
                    {t("awardIntro.analyzedPerformance")}
                </motion.p>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.5 }}
                    className="text-3xl font-medium"
                >
                    {t("awardIntro.foundTitle")}
                </motion.p>

                {/* <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 3.5, type: "spring" }}
                >
                    <Sparkles className="w-16 h-16 text-yellow-400 mx-auto" />
                </motion.div> */}
            </div>
        </div>
    );
}

// Helper to get confetti colors based on award color
const getAwardConfettiColors = (colorClass: string): string[] => {
    if (colorClass.includes('yellow')) return ['#fbbf24', '#f59e0b', '#ffffff'];
    if (colorClass.includes('red')) return ['#ef4444', '#dc2626', '#ffffff'];
    if (colorClass.includes('orange')) return ['#f97316', '#ea580c', '#ffffff'];
    if (colorClass.includes('green')) return ['#22c55e', '#16a34a', '#ffffff'];
    if (colorClass.includes('purple')) return ['#a855f7', '#9333ea', '#ffffff'];
    if (colorClass.includes('pink')) return ['#ec4899', '#db2777', '#ffffff'];
    if (colorClass.includes('cyan')) return ['#06b6d4', '#0891b2', '#ffffff'];
    if (colorClass.includes('teal')) return ['#14b8a6', '#0d9488', '#ffffff'];
    return ['#3b82f6', '#2563eb', '#ffffff']; // blue default
};

// Helper to get box-shadow color based on award color
const getAwardBorderColor = (colorClass: string): string => {
    if (colorClass.includes('yellow')) return 'rgba(234, 179, 8, 0.2)';
    if (colorClass.includes('red')) return 'rgba(239, 68, 68, 0.2)';
    if (colorClass.includes('orange')) return 'rgba(249, 115, 22, 0.2)';
    if (colorClass.includes('green')) return 'rgba(34, 197, 94, 0.2)';
    if (colorClass.includes('purple')) return 'rgba(168, 85, 247, 0.2)';
    if (colorClass.includes('pink')) return 'rgba(236, 72, 153, 0.2)';
    if (colorClass.includes('cyan')) return 'rgba(6, 182, 212, 0.2)';
    if (colorClass.includes('teal')) return 'rgba(20, 184, 166, 0.2)';
    return 'rgba(59, 130, 246, 0.2)'; // blue default
};

function AwardRevealSlide({ stats, t }: SlideProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const confettiInstanceRef = useRef<ReturnType<typeof confetti.create> | null>(null);
    const award = getAward(stats.awardType);
    const Icon = awardIcons[award.icon] || Plane;

    useEffect(() => {
        // Create a confetti instance bound to our canvas inside the story
        if (canvasRef.current && !confettiInstanceRef.current) {
            confettiInstanceRef.current = confetti.create(canvasRef.current, {
                resize: false,
                useWorker: true,
            });
        }

        // Fire confetti with award accent colors after a delay
        const timer = setTimeout(() => {
            if (confettiInstanceRef.current) {
                confettiInstanceRef.current({
                    particleCount: 180,
                    spread: 70,
                    origin: { x: 0.5, y: 0.5 },
                    colors: getAwardConfettiColors(award.color),
                    startVelocity: 45,
                    gravity: 0.8,
                    ticks: 300,
                });
            }
        }, 600);

        return () => {
            clearTimeout(timer);
            if (confettiInstanceRef.current) {
                confettiInstanceRef.current.reset();
            }
        };
    }, [award.color]);

    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-black text-white relative overflow-hidden">
            {/* Confetti canvas - fixed to canonical dimensions */}
            <canvas
                ref={canvasRef}
                width={CANONICAL_WIDTH}
                height={CANONICAL_HEIGHT}
                className="absolute inset-0 pointer-events-none z-20"
                style={{ width: '100%', height: '100%' }}
            />

            {/* Shiny Gold Background */}
            <div className="absolute inset-0 bg-gradient-to-tr from-yellow-400/50 via-black to-yellow-400/50" />

            {/* Header Text */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="relative z-10 mb-8 flex flex-col items-center gap-2"
            >
                <div className="p-3 bg-yellow-500/20 rounded-full mb-2" style={{ boxShadow: 'inset 0 0 0 1px rgba(234, 179, 8, 0.3)' }}>
                    <Trophy className="w-6 h-6 text-yellow-400" />
                </div>
                <h2 className="text-2xl font-bold text-zinc-100">{t("awardReveal.yourAward")}</h2>
            </motion.div>

            <motion.div
                initial={{ scale: 0.5, opacity: 0, rotateY: 90 }}
                animate={{ scale: 1, opacity: 1, rotateY: 0 }}
                transition={{ duration: 0.8, type: "spring", bounce: 0.3 }}
                className={cn("relative z-10 rounded-lg p-2.5 w-full max-w-sm shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center justify-between bg-[#161b22]", award.bg.replace(/border-[a-z]+-[0-9]+\/[0-9]+/g, ''))}
                style={{ boxShadow: `0 20px 50px rgba(0,0,0,0.5), inset 0 0 0 1px ${getAwardBorderColor(award.color)}` }}
            >
                <div className="flex flex-col items-start text-left">
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6 }}
                        className={cn("text-xs font-bold uppercase tracking-wider mb-1", award.color)}
                    >
                        {t(`awards.${stats.awardType}.title` as const)}
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7 }}
                        className="text-md sm:text-xl font-bold text-white leading-tight"
                    >
                        {t(`awards.${stats.awardType}.condition` as const)}
                    </motion.div>
                </div>
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.8, type: "spring" }}
                >
                    <Icon className={cn("w-10 h-10", award.color)} />
                </motion.div>
            </motion.div>

            <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.5 }}
                className="relative z-10 mt-8 text-sm text-zinc-100 max-w-xs"
            >
                {t(`awards.${stats.awardType}.description` as const)}
            </motion.p>
        </div>
    );
}

function OutroSlide({ year, yearStartDate, yearEndDate, stats, onClose, userName, userAvatar, t }: SlideProps) {
    const recapRef = useRef<HTMLDivElement>(null);
    const [isSharing, setIsSharing] = useState(false);
    const formatter = useFormatter();

    const award = getAward(stats.awardType);
    const Icon = awardIcons[award.icon] || Plane;

    // Format the most active month using next-intl
    const formattedMostActiveMonth = useMemo(() => {
        const [yearNum, monthNum] = stats.mostActiveMonth.month.split('-').map(Number);
        const date = new Date(yearNum, monthNum - 1, 1);
        return formatter.dateTime(date, { month: 'long' });
    }, [stats.mostActiveMonth.month, formatter]);

    const weeks = useMemo(() => {
        const result = [];
        const now = new Date();

        // Use provided year dates or fall back to parsing year name
        let startDate: Date;
        let endDate: Date;

        if (yearStartDate && yearEndDate) {
            startDate = new Date(yearStartDate);
            endDate = new Date(Math.min(new Date(yearEndDate).getTime(), now.getTime()));
        } else {
            const yearNum = parseInt(year);
            const targetYear = isNaN(yearNum) ? now.getFullYear() : yearNum;
            startDate = new Date(targetYear, 0, 1);
            const isCurrentYear = now.getFullYear() === targetYear;
            endDate = isCurrentYear ? now : new Date(targetYear, 11, 31);
        }

        const currentDate = new Date(startDate);
        const days = [];

        while (currentDate <= endDate) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const count = stats.heatmap[dateStr] || 0;
            days.push({
                date: new Date(currentDate),
                count,
                dateStr
            });
            currentDate.setDate(currentDate.getDate() + 1);
        }

        const w: (typeof days[0] | null)[][] = [];
        let currentWeek: (typeof days[0] | null)[] = Array(7).fill(null);

        // Pad beginning
        if (days.length > 0) {
            const firstDayOfWeek = days[0].date.getDay();
            for (let i = 0; i < firstDayOfWeek; i++) {
                currentWeek[i] = null;
            }
        }

        days.forEach((day) => {
            const dayIndex = day.date.getDay();
            currentWeek[dayIndex] = day;

            if (dayIndex === 6) {
                w.push(currentWeek);
                currentWeek = Array(7).fill(null);
            }
        });

        if (currentWeek.some(d => d !== null)) {
            w.push(currentWeek);
        }

        return w;
    }, [stats.heatmap, year, yearStartDate, yearEndDate]);

    // Calculate heatmap scale and container height to fit max height of 40px for the mini heatmap
    const { heatmapScale, heatmapHeight } = useMemo(() => {
        const MAX_HEIGHT = 60;
        const containerWidth = 390 - 48; // canonical width minus more padding for mini version
        const numWeeks = weeks.length || 1;
        const cellWidth = containerWidth / numWeeks;
        const naturalHeight = 7 * cellWidth; // 7 days per week
        const scale = Math.min(1, MAX_HEIGHT / naturalHeight);
        const height = Math.min(MAX_HEIGHT, naturalHeight);
        return { heatmapScale: scale, heatmapHeight: height };
    }, [weeks.length]);

    const handleShare = async () => {
        if (!recapRef.current || isSharing) return;

        setIsSharing(true);

        try {
            // Wait a frame for the content to fully render
            await new Promise(resolve => requestAnimationFrame(resolve));

            const dataUrl = await toPng(recapRef.current, {
                backgroundColor: '#0d1117',
                pixelRatio: 3, // High resolution for sharing
                cacheBust: true,
            });

            // Convert data URL to blob
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            const file = new File([blob], `avermate-recap-${year}.png`, { type: 'image/png' });

            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        files: [file],
                        title: `My ${year} Recap on Avermate`,
                        text: `I was in the top ${stats.topPercentile}% of Avermate users in ${year}!`,
                    });
                } catch (err) {
                    console.error("Error sharing:", err);
                    downloadImage(dataUrl);
                }
            } else {
                downloadImage(dataUrl);
            }
            setIsSharing(false);
        } catch (err) {
            console.error("Error generating image:", err);
            setIsSharing(false);
        }
    };

    const downloadImage = (dataUrl: string) => {
        const link = document.createElement('a');
        link.download = `avermate-recap-${year}.png`;
        link.href = dataUrl;
        link.click();
    };

    const container = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1,
                delayChildren: 0.3
            }
        }
    };

    const item = {
        hidden: { opacity: 0, scale: 0.9 },
        show: { opacity: 1, scale: 1 }
    };

    return (
        <div className="flex flex-col items-center h-full text-center p-3 bg-[#0d1117] text-white overflow-hidden relative">
            {/* Animated background gradients */}
            <motion.div
                className="absolute inset-0 pointer-events-none z-0"
                style={{
                    background: 'radial-gradient(circle at 50% 20%, rgba(99, 102, 241, 0.25) 0%, transparent 40%)',
                }}
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
                className="absolute inset-0 pointer-events-none z-0"
                style={{
                    background: 'radial-gradient(circle at 0% 60%, rgba(168, 85, 247, 0.2) 0%, transparent 35%)',
                }}
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            />
            <motion.div
                className="absolute inset-0 pointer-events-none z-0"
                style={{
                    background: 'radial-gradient(circle at 100% 85%, rgba(59, 130, 246, 0.2) 0%, transparent 35%)',
                }}
                animate={{ opacity: [0.5, 0.9, 0.5] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 2 }}
            />

            {/* Recap content to be captured */}
            <div ref={recapRef} className="w-full h-full flex flex-col p-3 relative z-10">
                {/* Header - sized for canonical viewport */}
                <div className="flex items-center gap-2 w-full mb-3 shrink-0">
                    {userAvatar ? (
                        <img src={userAvatar} alt={userName || ""} className="w-10 h-10 rounded-full object-cover" style={{ boxShadow: 'inset 0 0 0 2px rgba(255, 255, 255, 0.2)' }} />
                    ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center font-bold text-base">
                            {year.slice(-2)}
                        </div>
                    )}
                    <div className="text-left">
                        {userName && <div className="font-bold text-base">{userName}</div>}
                        <div className="text-[10px] text-[#8b949e]">{t("outro.recapBrand", { year })}</div>
                    </div>
                </div>

                {/* Grid Layout - Flex grow to fill space */}
                <motion.div
                    className="flex flex-col flex-1"
                    variants={container}
                    initial="hidden"
                    animate="show"
                >

                    {/* Mini Heatmap Visual (Real Data) - sized for canonical viewport */}
                    <motion.div variants={item} className="w-full bg-[#161b22] rounded-xl p-3 mb-3 shrink-0 flex flex-col items-center" style={{ boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1)' }}>
                        <div className="w-full flex justify-center overflow-hidden" style={{ height: heatmapHeight }}>
                            <div
                                className="flex gap-[1px] w-full"
                                style={{ transform: `scale(${heatmapScale})`, transformOrigin: 'top center' }}
                            >
                                {weeks.map((week, weekIndex) => (
                                    <div
                                        key={weekIndex}
                                        className="flex-1 flex flex-col gap-[1px]"
                                    >
                                        {week.map((day, dayIndex) => (
                                            <div
                                                key={`${weekIndex}-${dayIndex}`}
                                                className={cn(
                                                    "w-full aspect-square rounded-full",
                                                    !day ? "bg-transparent" :
                                                        day.count === 0 ? "bg-[#161b22]" :
                                                            day.count === 1 ? "bg-[#1d2d60]" :
                                                                day.count <= 3 ? "bg-[#2d4696]" :
                                                                    "bg-[#3e61d2]"
                                                )}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="text-left text-[10px] text-[#8b949e] mt-1.5">
                            {t("outro.gradesInYear", { count: stats.gradesCount, year })}
                        </div>
                    </motion.div>

                    <div className="grid grid-cols-2 auto-rows-fr gap-2 w-full mb-3 flex-1">
                        <StatCard
                            icon={Trophy}
                            title={t("outro.universalRank")}
                            value={t("outro.topPercent", { percent: stats.topPercentile })}
                            colorClass="text-yellow-400"
                            variants={item}
                        />
                        <StatCard
                            icon={Zap}
                            title={t("outro.longestStreak")}
                            value={stats.longestStreak}
                            colorClass="text-emerald-400"
                            variants={item}
                        />

                        <StatCard
                            icon={Activity}
                            title={t("outro.totalGrades")}
                            value={stats.gradesCount}
                            colorClass="text-pink-400"
                            variants={item}
                        />
                        <StatCard
                            icon={Calendar}
                            title={t("outro.mostActiveMonth")}
                            value={formattedMostActiveMonth}
                            colorClass="text-purple-400"
                            variants={item}
                        />
                        <StatCard
                            icon={Star}
                            title={t("outro.totalPoints")}
                            value={stats.gradesSum.toFixed(0)}
                            colorClass="text-blue-400"
                            variants={item}
                        />
                        <StatCard
                            icon={Target}
                            title={t("outro.globalAverage")}
                            value={stats.average?.toFixed(2) || "N/A"}
                            colorClass="text-teal-400"
                            variants={item}
                        />
                        <StatCard
                            icon={Rocket}
                            title={t("outro.topSubject")}
                            value={stats.bestSubjects[0]?.name || "N/A"}
                            colorClass="text-cyan-400"
                            truncate={true}
                            className="col-span-2"
                            variants={item}
                        />
                    </div>

                    <div>
                        {/* Award Card */}
                        <motion.div variants={item} className={cn("col-span-2 rounded-lg p-2.5 flex items-center justify-between gap-2 bg-[#161b22]", award.bg.replace(/border-[a-z]+-[0-9]+\/[0-9]+/g, ''))} style={{ boxShadow: `inset 0 0 0 1px ${getAwardBorderColor(award.color)}` }}>
                            <div className="flex flex-col items-start text-left min-w-0 flex-1">
                                <div className={cn("text-xs font-bold uppercase tracking-wider mb-1", award.color)}>
                                    {t(`awards.${stats.awardType}.title` as const)}
                                </div>
                                <div className="text-lg font-bold text-white leading-tight truncate w-full">
                                    {t(`awards.${stats.awardType}.condition` as const)}
                                </div>
                            </div>
                            <Icon className={cn("w-10 h-10 shrink-0", award.color)} />
                        </motion.div>
                    </div>

                    <div className="mt-2 text-xs text-[#8b949e] shrink-0">
                        avermate.fr
                    </div>

                </motion.div>

            </div>

            {/* Buttons (not captured) - sized for canonical viewport */}
            <div className="flex gap-2 w-full mb-3 shrink-0">
                <Button
                    className="flex-1 bg-white hover:bg-gray-200 text-black border-none h-10 rounded-lg font-bold text-sm"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleShare();
                    }}
                    disabled={isSharing}
                >
                    <Share2 className="w-3.5 h-3.5 mr-1.5" /> {isSharing ? t("outro.generating") : t("outro.shareImage")}
                </Button>

                <Button
                    variant="outline"
                    className="flex-1 border-none bg-[#21262d] hover:bg-[#30363d] text-white h-10 rounded-lg text-sm"
                    style={{ boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.2)' }}
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                >
                    {t("outro.close")}
                </Button>
            </div>
        </div>
    );
}

// ... Main Story Component ... (keep as is)
export function YearReviewStory({ stats, year, yearStartDate, yearEndDate, isOpen, onClose, userName, userAvatar }: YearReviewStoryProps) {
    const t = useTranslations("YearReview");
    const [currentSlide, setCurrentSlide] = useState(0);
    const [paused, setPaused] = useState(false);
    const [progress, setProgress] = useState(0);
    const [isNavigating, setIsNavigating] = useState(false);
    const [isMuted, setIsMuted] = useState(false); // Start with music enabled by default
    // Track animated bar states: { index: targetProgress }
    const [animatedBars, setAnimatedBars] = useState<Record<number, number>>({});
    const [stepDuration, setStepDuration] = useState(120); // Dynamic per-step duration
    const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const storyContainerRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Get the complete layout with zoom compensation
    const layout = useStoryLayout();

    const slides = useMemo(() => [
        { component: IntroSlide, duration: 3000 },
        { component: StatsSlide, duration: 6000 },
        { component: HeatmapSlide, duration: 6000 },
        { component: StreakSlide, duration: 3500 },
        { component: PrimeTimeSlide, duration: 7000 },
        { component: SubjectsSlide, duration: 5000 },
        { component: AwardIntroSlide, duration: 3000 },
        { component: AwardRevealSlide, duration: 6000 },
        { component: PercentileSlide, duration: 6000 },
        { component: OutroSlide, duration: 10000 }, // Last slide: progress fills but doesn't auto-close
    ], []);

    const isLastSlide = currentSlide === slides.length - 1;

    const CurrentComponent = slides[currentSlide].component;

    // Initialize audio on mount
    useEffect(() => {
        audioRef.current = new Audio('/recap-music.mp3');
        audioRef.current.loop = true;
        audioRef.current.volume = 0.5;

        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);

    // Handle audio play/pause based on isOpen and isMuted
    useEffect(() => {
        if (!audioRef.current) return;

        if (isOpen && !isMuted) {
            audioRef.current.play().catch(() => {
                // Autoplay might be blocked, user will need to unmute manually
            });
        } else {
            audioRef.current.pause();
            if (!isOpen) {
                audioRef.current.currentTime = 0;
            }
        }
    }, [isOpen, isMuted]);

    // Reset to first slide when opening
    useEffect(() => {
        if (isOpen) {
            setCurrentSlide(0);
            setProgress(0);
            setPaused(false);
            setIsNavigating(false);
            setAnimatedBars({});
        }
    }, [isOpen]);

    // Auto-progress using interval (only updates progress, doesn't change slides)
    useEffect(() => {
        if (paused || !isOpen || isNavigating) {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
            return;
        }

        const duration = slides[currentSlide].duration;
        const intervalTime = 50;
        const increment = (intervalTime / duration) * 100;

        progressIntervalRef.current = setInterval(() => {
            setProgress(prev => Math.min(prev + increment, 100));
        }, intervalTime);

        return () => {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
        };
    }, [currentSlide, paused, isOpen, isNavigating, slides]);

    // Auto-advance when progress reaches 100 (but not on the last slide)
    useEffect(() => {
        if (progress >= 100 && !isNavigating && !paused && isOpen) {
            if (currentSlide < slides.length - 1) {
                setCurrentSlide(prev => prev + 1);
                setProgress(0);
            }
            // On last slide: progress stays at 100, doesn't auto-close
        }
    }, [progress, currentSlide, slides.length, isNavigating, paused, isOpen]);

    // Total animation time is constant regardless of steps
    const TOTAL_ANIMATION_TIME = 350;
    const MIN_STEP_DURATION = 60; // Minimum per-step to keep it visible

    // Cascading animation for multi-step navigation
    const animateToSlide = useCallback((targetIndex: number) => {
        if (isNavigating || targetIndex === currentSlide) return;
        if (targetIndex < 0 || targetIndex >= slides.length) return;

        const steps = Math.abs(targetIndex - currentSlide);
        const direction = targetIndex > currentSlide ? 'forward' : 'backward';

        // For backward navigation, we need one extra step to animate the target bar too
        const totalSteps = direction === 'backward' ? steps + 1 : steps;

        // Calculate per-step duration: total time divided by steps, with a minimum
        const perStepDuration = Math.max(MIN_STEP_DURATION, Math.floor(TOTAL_ANIMATION_TIME / totalSteps));
        setStepDuration(perStepDuration);

        setIsNavigating(true);

        if (direction === 'forward') {
            // Going forward: fill bars one by one from currentSlide to targetIndex-1
            for (let i = 0; i < steps; i++) {
                const barIndex = currentSlide + i;
                setTimeout(() => {
                    setAnimatedBars(prev => ({ ...prev, [barIndex]: 100 }));
                }, i * perStepDuration);
            }
        } else {
            // Going backward: empty bars one by one from currentSlide down to targetIndex (inclusive)
            // This includes the target bar so it smoothly animates to 0 before we land on it
            for (let i = 0; i <= steps; i++) {
                const barIndex = currentSlide - i;
                setTimeout(() => {
                    setAnimatedBars(prev => ({ ...prev, [barIndex]: 0 }));
                }, i * perStepDuration);
            }
        }

        // After all animations complete, switch to target slide
        const totalTime = totalSteps * perStepDuration;
        setTimeout(() => {
            setCurrentSlide(targetIndex);
            setProgress(0);
            setAnimatedBars({});
            setIsNavigating(false);
        }, totalTime + 30);
    }, [currentSlide, isNavigating, slides.length]);

    const nextSlide = useCallback(() => {
        if (isNavigating) return;
        if (currentSlide < slides.length - 1) {
            animateToSlide(currentSlide + 1);
        }
        // On last slide: do nothing (don't close)
    }, [currentSlide, slides.length, isNavigating, animateToSlide]);

    const prevSlide = useCallback(() => {
        if (isNavigating) return;
        if (currentSlide > 0) {
            animateToSlide(currentSlide - 1);
        }
    }, [currentSlide, isNavigating, animateToSlide]);

    const goToSlide = useCallback((targetIndex: number) => {
        animateToSlide(targetIndex);
    }, [animateToSlide]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight') nextSlide();
            if (e.key === 'ArrowLeft') prevSlide();
            if (e.key === 'Escape') onClose();
            if (e.key === ' ') {
                e.preventDefault();
                setPaused(p => !p);
            }
        };

        if (isOpen) {
            window.addEventListener('keydown', handleKeyDown);
        }
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, nextSlide, prevSlide, onClose]);

    const handleClick = (e: React.MouseEvent) => {
        if (e.defaultPrevented) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;

        if (x < width * 0.3) {
            prevSlide();
        } else if (x > width * 0.7) {
            nextSlide();
        }
    };

    // Get the display progress for a bar
    const getBarProgress = (index: number): number => {
        // Check if this bar is being animated
        if (index in animatedBars) {
            return animatedBars[index];
        }
        // Default states based on position relative to current slide
        if (index < currentSlide) return 100;
        if (index > currentSlide) return 0;
        // Current slide (not animating)
        return progress;
    };

    if (!isOpen) return null;

    const {
        storyScale,
        showNavButtons,
        storyWidth,
        storyHeight,
        navButtonSize,
        closeButtonSize,
        buttonGap,
        closeButtonGap,
    } = layout;

    return (
        <div className="fixed inset-0 z-[100] bg-black overflow-hidden">
            {/* 
                Layout structure:
                - Outer container fills viewport (no flex to avoid high-zoom cropping)
                - All children use absolute positioning relative to viewport center
                - Button sizes are zoom-compensated to appear constant physical size
                - Story scales to fill available space after margins/buttons
            */}

            {/* Close Button - positioned at top-right of story, zoom-compensated size */}
            <button
                onClick={onClose}
                className="absolute z-[110] text-white/50 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors flex items-center justify-center"
                style={{
                    width: closeButtonSize,
                    height: closeButtonSize,
                    top: `calc(50% - ${storyHeight / 2}px - ${closeButtonSize + closeButtonGap}px)`,
                    left: `calc(50% + ${storyWidth / 2}px - ${closeButtonSize}px)`,
                }}
                aria-label={t("controls.close")}
            >
                <X style={{ width: closeButtonSize * 0.5, height: closeButtonSize * 0.5 }} />
            </button>

            {/* Left Navigation Button - hidden on small screens, zoom-compensated size */}
            {showNavButtons && (
                <button
                    onClick={prevSlide}
                    className={`absolute z-[110] rounded-full transition-colors flex items-center justify-center ${currentSlide === 0
                        ? 'text-white/20 bg-white/5 cursor-not-allowed'
                        : 'text-white/50 hover:text-white bg-white/10 hover:bg-white/20'
                        }`}
                    style={{
                        width: navButtonSize,
                        height: navButtonSize,
                        left: `calc(50% - ${storyWidth / 2}px - ${navButtonSize + buttonGap}px)`,
                        top: '50%',
                        transform: 'translateY(-50%)',
                    }}
                    aria-label={t("controls.previousSlide")}
                    disabled={currentSlide === 0}
                >
                    <ChevronLeft style={{ width: navButtonSize * 0.5, height: navButtonSize * 0.5 }} />
                </button>
            )}

            {/* Right Navigation Button - hidden on small screens, zoom-compensated size */}
            {showNavButtons && (
                <button
                    onClick={nextSlide}
                    className={`absolute z-[110] rounded-full transition-colors flex items-center justify-center ${isLastSlide
                        ? 'text-white/20 bg-white/5 cursor-not-allowed'
                        : 'text-white/50 hover:text-white bg-white/10 hover:bg-white/20'
                        }`}
                    style={{
                        width: navButtonSize,
                        height: navButtonSize,
                        right: `calc(50% - ${storyWidth / 2}px - ${navButtonSize + buttonGap}px)`,
                        top: '50%',
                        transform: 'translateY(-50%)',
                    }}
                    aria-label={t("controls.nextSlide")}
                    disabled={isLastSlide}
                >
                    <ChevronRight style={{ width: navButtonSize * 0.5, height: navButtonSize * 0.5 }} />
                </button>
            )}

            {/* Ambilight + Story Container wrapper - centered */}
            <div
                className="absolute"
                style={{
                    left: '50%',
                    top: '50%',
                    transform: `translate(-50%, -50%) scale(${storyScale})`,
                    transformOrigin: 'center center',
                }}
            >
                <AmbilightWrapper storyScale={storyScale}>
                    {/* Story Content */}
                    <div
                        ref={storyContainerRef}
                        className="bg-black shadow-2xl overflow-hidden cursor-pointer select-none"
                        style={{
                            width: CANONICAL_WIDTH,
                            height: CANONICAL_HEIGHT,
                            borderRadius: 24,
                            // Additional GPU hints
                            willChange: 'transform',
                            backfaceVisibility: 'hidden',
                            // CSS variable for inverse scale
                            //@ts-expect-error nike ta race
                            '--border-scale': 1 / storyScale,
                        }}
                        onClick={handleClick}
                    >
                        {/* Progress Bars */}
                        <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-2">
                            {slides.map((_, index) => {
                                const barProgress = getBarProgress(index);
                                return (
                                    <button
                                        key={index}
                                        className="h-3 flex-1 bg-transparent rounded-full overflow-hidden cursor-pointer group py-1"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            goToSlide(index);
                                        }}
                                        aria-label={t("controls.goToSlide", { number: index + 1 })}
                                    >
                                        <div className="h-1 w-full bg-white/30 rounded-full overflow-hidden group-hover:bg-white/40 transition-colors">
                                            <div
                                                className="h-full bg-white"
                                                style={{
                                                    width: `${barProgress}%`,
                                                    transition: isNavigating ? `width ${stepDuration}ms linear` : 'width 50ms linear'
                                                }}
                                            />
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Pause Button */}
                        <button
                            onClick={(e) => { e.stopPropagation(); setPaused(p => !p); }}
                            className="absolute top-8 right-2 z-20 text-white/70 hover:text-white p-1.5 bg-black/30 rounded-full backdrop-blur-sm"
                            aria-label={paused ? t("controls.play") : t("controls.pause")}
                        >
                            {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                        </button>

                        {/* Music/Mute Button */}
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsMuted(m => !m); }}
                            className="absolute bottom-3 right-2 z-20 text-white/70 hover:text-white p-1.5 bg-black/30 rounded-full backdrop-blur-sm flex items-center justify-center"
                            aria-label={isMuted ? t("controls.unmute") : t("controls.mute")}
                        >
                            <MusicBarsIcon isMuted={isMuted} />
                        </button>

                        {/* Content */}
                        <div className="relative w-full h-full z-10">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={currentSlide}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="w-full h-full"
                                >
                                    <CurrentComponent
                                        stats={stats}
                                        year={year}
                                        yearStartDate={yearStartDate}
                                        yearEndDate={yearEndDate}
                                        onClose={onClose}
                                        userName={userName}
                                        userAvatar={userAvatar}
                                        t={t}
                                    />
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </div>
                </AmbilightWrapper>
            </div>
        </div>
    );
}
