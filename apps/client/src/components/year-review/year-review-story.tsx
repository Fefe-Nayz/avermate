"use client";

import { motion, AnimatePresence, animate, useMotionValue, useTransform } from "framer-motion";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Share2, Sparkles, Trophy, TrendingUp, Calendar, Zap, Award, Star, Activity, Rocket, Pause, Play, Crown, BookOpen, Target, Scale, RefreshCcw, Dices, Shuffle, Crosshair, Gem, UserCheck, Plane } from "lucide-react";
import { YearReviewStats } from "@/types/year-review";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import confetti from "canvas-confetti";
import html2canvas from "html2canvas-pro";

// --- Slides ---

interface SlideProps {
    stats: YearReviewStats;
    year: string;
    onClose: () => void;
    userName?: string;
    userAvatar?: string;
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

function IntroSlide({ year, userName, userAvatar }: SlideProps) {
    return (
        <div className="relative flex flex-col items-center justify-center h-full text-center p-6 bg-[#0a0a0a] text-white overflow-hidden">
            {/* Animated gradient orbs */}
            <motion.div
                className="absolute top-1/4 -left-20 w-72 h-72 bg-emerald-500/30 rounded-full blur-[100px]"
                animate={{
                    x: [0, 30, 0],
                    y: [0, -20, 0],
                    scale: [1, 1.1, 1]
                }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
                className="absolute bottom-1/4 -right-20 w-80 h-80 bg-cyan-500/25 rounded-full blur-[120px]"
                animate={{
                    x: [0, -40, 0],
                    y: [0, 30, 0],
                    scale: [1, 1.2, 1]
                }}
                transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-teal-400/20 rounded-full blur-[150px]"
                animate={{
                    scale: [1, 1.3, 1],
                    opacity: [0.2, 0.35, 0.2]
                }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Content */}
            <div className="relative z-10 flex flex-col items-center">
                {/* Logo/Avatar with ring animation */}
                <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, type: "spring", bounce: 0.4 }}
                    className="relative mb-8"
                >
                    {/* Animated rings - positioned outside the logo box */}
                    <motion.div
                        className="absolute inset-0 rounded-full border-2 border-emerald-400/50"
                        style={{ margin: -16 }}
                        animate={{ scale: [1.15, 1.30, 1.15], opacity: [0.6, 0, 0.6] }}
                        transition={{ duration: 2, repeat: Infinity }}
                    />
                    <motion.div
                        className="absolute inset-0 rounded-full border border-cyan-400/40"
                        style={{ margin: -28 }}
                        animate={{ scale: [1.2, 1.4, 1.2], opacity: [0.4, 0, 0.4] }}
                        transition={{ duration: 2.5, repeat: Infinity, delay: 0.3 }}
                    />
                    <motion.div
                        className="absolute inset-0 rounded-full border border-teal-400/20"
                        style={{ margin: -40 }}
                        animate={{ scale: [1.25, 1.5, 1.25], opacity: [0.2, 0, 0.2] }}
                        transition={{ duration: 3, repeat: Infinity, delay: 0.6 }}
                    />

                    {userAvatar ? (
                        <div className="w-28 h-28 rounded-2xl p-1 shadow-[0_0_40px_rgba(16,185,129,0.4)]">
                            <img
                                src={userAvatar}
                                alt={userName || "User"}
                                className="w-full h-full rounded-[14px] object-cover"
                            />
                        </div>
                    ) : (
                        <div className="w-28 h-28 rounded-2xl p-1 shadow-[0_0_40px_rgba(16,185,129,0.4)]">
                            <div className="w-full h-full rounded-2xl bg-[#0a0a0a] flex items-center justify-center overflow-hidden">
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
                        className="text-lg font-medium text-gray-300 mb-3"
                    >
                        {userName}
                    </motion.p>
                )}

                {/* Year - Big dramatic reveal */}
                <motion.h1
                    initial={{ opacity: 0, y: 30, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 0.5, duration: 0.6, type: "spring" }}
                    className="text-7xl font-black mb-4 tracking-tight bg-gradient-to-r from-emerald-300 via-cyan-300 to-teal-300 bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(16,185,129,0.5)]"
                >
                    {year}
                </motion.h1>

                {/* Subtitle */}
                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7 }}
                    className="text-2xl font-bold mb-3 text-white"
                >
                    Year in Review
                </motion.h2>

                {/* Tagline */}
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.6 }}
                    transition={{ delay: 0.9 }}
                    className="text-base text-gray-400"
                >
                    Your academic journey, visualized
                </motion.p>

                {/* Tap indicator */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 0.5, y: 0 }}
                    transition={{ delay: 1.2 }}
                    className="absolute -bottom-20 flex flex-col items-center gap-2"
                >
                    <motion.div
                        animate={{ y: [0, 5, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="text-xs text-gray-500 uppercase tracking-widest"
                    >
                        Tap to continue
                    </motion.div>
                </motion.div>
            </div>
        </div>
    );
}

function StatsSlide({ stats }: SlideProps) {
    const [zoomOut, setZoomOut] = useState(false);

    // Calculate dynamic offset to center on Grades bar
    // Layout: [GradesBar(128px)] [gap(64px)] [PointsBar(128px)]
    // Center of Grades bar is (64/2 + 128/2) = 96px left of container center
    // With scale, we need to offset by: distanceToCenter * scale
    const SCALE = 3.5;
    const BAR_WIDTH = 128; // w-32 = 8rem = 128px
    const GAP = 64; // gap-16 = 4rem = 64px
    const distanceToGradesCenter = (GAP / 2) + (BAR_WIDTH / 2); // 96px
    const xOffset = distanceToGradesCenter * SCALE; // ~336px

    useEffect(() => {
        const timer = setTimeout(() => setZoomOut(true), 2500);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-gradient-to-br from-blue-500 to-cyan-500 text-white overflow-hidden relative">
            <motion.div
                initial={{ scale: SCALE, y: 190, x: xOffset }}
                animate={zoomOut
                    ? { scale: 1, y: 0, x: 0 } // Zoom out to full view
                    : { scale: SCALE, y: 320, x: xOffset } // Track the growing bar upwards, keep centered on Grades
                }
                transition={zoomOut
                    ? { duration: 0.8, type: "spring", bounce: 0.2 } // Zoom out transition
                    : { duration: 2, ease: "easeOut" } // Tracking transition (matches bar growth)
                }
                className="flex items-end justify-center gap-16 h-80 w-full max-w-lg"
            >
                {/* Grades Bar */}
                <div className="flex flex-col items-center gap-4 w-32 relative">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={zoomOut ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                        className="text-2xl font-bold whitespace-nowrap absolute -top-12"
                    >
                        Grades
                    </motion.div>

                    <div className="relative w-full h-80 bg-white/10 rounded-t-3xl overflow-hidden flex items-end backdrop-blur-sm border border-white/10">
                        {/* Growing Fill */}
                        <motion.div
                            initial={{ height: "0%" }}
                            animate={{ height: "60%" }}
                            transition={{ duration: 2, ease: "easeOut" }}
                            className="w-full bg-white relative shadow-[0_0_20px_rgba(255,255,255,0.5)]"
                        >
                            {/* Ticking Value on top of the bar */}
                            <div className="absolute -top-14 left-1/2 -translate-x-1/2 text-center w-40">
                                <span className="text-5xl font-black text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)]">
                                    <CountUp value={stats.gradesCount} duration={2} />
                                </span>
                            </div>
                        </motion.div>
                    </div>
                </div>

                {/* Points Bar */}
                <div className="flex flex-col items-center gap-4 w-32 relative">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={zoomOut ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                        transition={{ delay: 0.1 }}
                        className="text-2xl font-bold whitespace-nowrap absolute -top-12"
                    >
                        Points
                    </motion.div>

                    <div className="relative w-full h-80 bg-white/10 rounded-t-3xl overflow-hidden flex items-end backdrop-blur-sm border border-white/10">
                        <motion.div
                            initial={{ height: "0%" }}
                            animate={zoomOut ? { height: "75%" } : { height: "0%" }}
                            transition={{ duration: 1.5, ease: "easeOut", delay: 0.2 }}
                            className="w-full bg-yellow-300 relative shadow-[0_0_20px_rgba(253,224,71,0.5)]"
                        >
                            {zoomOut && (
                                <div className="absolute -top-14 left-1/2 -translate-x-1/2 text-center w-40">
                                    <span className="text-4xl font-black text-yellow-300 drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)]">
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
                animate={zoomOut ? { opacity: 0.7, y: 0 } : { opacity: 0, y: 20 }}
                transition={{ delay: 0.8 }}
                className="mt-12 text-sm max-w-xs mx-auto"
            >
                Accumulated points throughout the year
            </motion.p>
        </div>
    );
}

function HeatmapSlide({ stats, year, userName, userAvatar }: SlideProps) {
    const [zoomOut, setZoomOut] = useState(false);

    const days = useMemo(() => {
        const result = [];
        const yearNum = parseInt(year);
        const targetYear = isNaN(yearNum) ? new Date().getFullYear() : yearNum;

        const startDate = new Date(targetYear, 0, 1);
        const now = new Date();
        const isCurrentYear = now.getFullYear() === targetYear;
        const endDate = isCurrentYear ? now : new Date(targetYear, 11, 31);

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
    }, [stats.heatmap, year]);

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
        const timer = setTimeout(() => setZoomOut(true), 2200);
        return () => clearTimeout(timer);
    }, []);

    // Animation values for the heatmap camera
    const SCALE = 3.5;
    // Pan positions - start far right to show first weeks, end at left to show recent weeks
    const START_X = 1400; // Start position (first day visible on right side)
    const END_X = -800;   // End position (keep as is)

    return (
        <div className="flex flex-col items-center justify-center gap-30 h-full text-center p-4 bg-[#0d1117] text-white overflow-hidden relative">
            {/* Background Gradients */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[20%] -right-[20%] w-[600px] h-[600px] bg-[#3e61d2]/10 rounded-full blur-[120px]" />
                <div className="absolute -bottom-[20%] -left-[20%] w-[500px] h-[500px] bg-[#3e61d2]/5 rounded-full blur-[100px]" />
            </div>

            {/* Header - appears after zoom out */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={zoomOut ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
                transition={{ duration: 0.5 }}
                className="w-full relative z-10"
            >
                <div className="flex items-center justify-center gap-3">
                    {userAvatar ? (
                        <img src={userAvatar} alt={userName || ""} className="w-12 h-12 rounded-full border-2 border-white/20 object-cover" />
                    ) : (
                        <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white/20">
                            <div className="w-full h-full bg-gradient-to-br from-[#3e61d2] to-blue-500" />
                        </div>
                    )}
                    <div className="text-left">
                        {userName && <div className="font-bold text-lg">{userName}</div>}
                        <div className="text-sm opacity-60">{year} Year in Grades</div>
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
                    ? { duration: 0.6, type: "spring", bounce: 0.1 }
                    : { duration: 2, ease: [0.25, 0.8, 0.25, 1] } // Custom cubic bezier (easeOutQuad style)
                }
                className="w-full bg-[#161b22]/80 backdrop-blur-sm p-4 rounded-2xl border border-white/10 shadow-2xl relative z-10"
            >
                <div className="w-full">
                    <div className="flex gap-[2px] w-full">
                        {weeks.map((week, weekIndex) => (
                            <div
                                key={weekIndex}
                                className="flex-1 flex flex-col gap-[2px]"
                            >
                                {week.map((day, dayIndex) => (
                                    <div
                                        key={`${weekIndex}-${dayIndex}`}
                                        className={cn(
                                            "w-full aspect-square rounded-[1px] sm:rounded-[2px]",
                                            !day ? "bg-transparent" :
                                                day.count === 0 ? "bg-[#161b22] border border-white/5" :
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

                {/* Grade count - appears after zoom out */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={zoomOut ? { opacity: 1 } : { opacity: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-left mt-4 text-sm text-[#8b949e] w-full"
                >
                    {stats.gradesCount} grades in {year}
                </motion.div>
            </motion.div>

            {/* Most Active Month - appears after zoom out */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={zoomOut ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                transition={{ delay: 0.4, duration: 0.5 }}
                className="w-full relative z-10"
            >
                <h3 className="text-lg text-[#8b949e] mb-3">Most Active Month</h3>
                <div className="text-5xl font-black uppercase tracking-wider bg-gradient-to-r from-[#3e61d2] to-[#5e81f2] bg-clip-text text-transparent">
                    {stats.mostActiveMonth.month}
                </div>
                <p className="text-base mt-3 text-[#8b949e]">{stats.mostActiveMonth.count} grades entered</p>
            </motion.div>
        </div>
    );
}

function StreakSlide({ stats }: SlideProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-black text-white relative overflow-hidden">
            {/* Background gradient */}
            <motion.div 
                className="absolute inset-0 bg-gradient-to-tr from-red-900 via-black to-orange-900 opacity-60"
                animate={{
                    scale: [1, 1.2, 1],
                    opacity: [0.5, 0.8, 0.5],
                }}
                transition={{
                    duration: 8,
                    repeat: Infinity,
                    ease: "easeInOut"
                }}
            />
            
            {/* Warm glow effects */}
            <motion.div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-600/10 rounded-full blur-[120px]"
                animate={{
                    scale: [1, 1.1, 1],
                    opacity: [0.3, 0.6, 0.3],
                }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            />

            <div className="relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500/20 rounded-full border border-orange-500/40 text-orange-300 mb-8"
                >
                    <div className="text-lg">🔥</div>
                    <span className="font-bold text-sm uppercase tracking-wider">On Fire!</span>
                </motion.div>

                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-3xl font-bold mb-4"
                >
                    Longest Streak
                </motion.h2>

                <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 200, delay: 0.4 }}
                    className="text-[12rem] leading-none font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 via-orange-500 to-red-600 drop-shadow-[0_0_50px_rgba(234,88,12,0.5)]"
                >
                    <CountUp value={5} duration={1.5} delay={0.5} ease="circOut" />
                </motion.div>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8 }}
                    className="mt-8 text-xl opacity-60 max-w-xs mx-auto"
                >
                    Consecutive grades that increased your average
                </motion.p>
            </div>
        </div>
    );
}

function PrimeTimeSlide({ stats }: SlideProps) {
    const date = new Date(stats.primeTime.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-gradient-to-br from-yellow-400 to-amber-600 text-white">
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <h2 className="text-3xl font-bold mb-8">Prime Time</h2>
            </motion.div>

            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="bg-white/20 backdrop-blur-lg rounded-full w-48 h-48 flex flex-col items-center justify-center mb-6 border-4 border-white/30"
            >
                <span className="text-4xl font-bold">{stats.primeTime.value.toFixed(2)}</span>
                <span className="text-sm">/20</span>
            </motion.div>

            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-2xl"
            >
                Peak reached on<br /><strong>{date}</strong>
            </motion.p>
        </div>
    );
}

function SubjectsSlide({ stats }: SlideProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-gradient-to-br from-pink-500 to-rose-600 text-white">
            <h2 className="text-3xl font-bold mb-8">Top Subjects</h2>

            <div className="w-full max-w-md space-y-4">
                {stats.bestSubjects.map((subject, index) => (
                    <motion.div
                        key={subject.name}
                        initial={{ opacity: 0, x: -50 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.2 + 0.2 }}
                        className="bg-white/10 backdrop-blur-md rounded-xl p-4 flex justify-between items-center"
                    >
                        <div className="flex items-center gap-3">
                            <span className="font-bold text-xl w-6">#{index + 1}</span>
                            <span className="text-lg truncate max-w-[150px]">{subject.name}</span>
                        </div>
                        <span className="text-2xl font-bold">{subject.value.toFixed(2)}</span>
                    </motion.div>
                ))}
            </div>

            {stats.bestProgression.value > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1 }}
                    className="mt-8 p-4 bg-white/20 rounded-xl w-full max-w-md"
                >
                    <div className="text-sm uppercase tracking-wider mb-1">Best Comeback 🚀</div>
                    <div className="font-bold text-xl">{stats.bestProgression.subject}</div>
                    <div className="text-sm opacity-80">+{stats.bestProgression.value.toFixed(2)} pts improvement</div>
                </motion.div>
            )}
        </div>
    );
}

function PercentileSlide({ stats }: SlideProps) {
    useEffect(() => {
        confetti({
            particleCount: 150,
            spread: 90,
            origin: { y: 0.6 },
            colors: ['#ffffff', '#fbbf24']
        });
    }, []);

    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-black text-white relative overflow-hidden">
            {/* Background gradient */}
            <div className="absolute inset-0 bg-gradient-to-tr from-purple-900 via-black to-indigo-900 opacity-60" />


            <div className="relative z-10">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-500/20 rounded-full border border-yellow-500/40 text-yellow-300 mb-8"
                >
                    <Trophy className="w-4 h-4" />
                    <span className="font-bold text-sm uppercase tracking-wider">Legendary Status</span>
                </motion.div>

                <motion.h2
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-3xl font-bold mb-4"
                >
                    You are in the top
                </motion.h2>

                <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 200, delay: 0.3 }}
                    className="text-[12rem] leading-none font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-700 drop-shadow-[0_0_50px_rgba(234,179,8,0.5)]"
                >
                    {stats.topPercentile}%
                </motion.div>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8 }}
                    className="mt-8 text-xl opacity-60 max-w-xs mx-auto"
                >
                    of the most active students this year!
                </motion.p>
            </div>
        </div>
    );
}

// Stats Card Component
function StatCard({ icon: Icon, title, value, colorClass, truncate = false, className }: { icon: any, title: string, value: string | number, colorClass: string, truncate?: boolean, className?: string }) {
    return (
        <div className={cn("bg-[#161b22] border border-white/10 rounded-xl p-4 flex flex-col items-start h-full", className)}>
            <div className="flex items-center gap-2 mb-1">
                <Icon className={cn("w-4 h-4", colorClass)} />
                <span className="text-xs text-gray-400 font-medium">{title}</span>
            </div>
            <div className={cn(
                "text-4xl sm:text-5xl font-bold my-auto text-left leading-[0.9] capitalize",
                colorClass,
                truncate && "line-clamp-2 w-full break-words"
            )}>
                {value}
            </div>
        </div>
    );
}

const getAward = (stats: YearReviewStats) => {
    // Helper to safely access potential future properties
    const s = stats as any;

    // 1. Le Funambule
    if (stats.average >= 10 && stats.average <= 11 && (s.gradesUnder8Count || 0) >= 3) {
        return {
            title: "Le Funambule",
            icon: Scale,
            description: "Tu as marché sur un fil toute l'année, le vide à gauche, le vide à droite... mais tu n'es jamais tombé. L'art de l'équilibre, le vrai.",
            condition: "Moyenne entre 10 et 11 avec des notes < 8/20",
            color: "text-orange-400",
            bg: "bg-orange-500/10 border-orange-500/20",
            gradient: "from-orange-500 to-amber-500"
        };
    }

    // 2. Le Roi du Comeback
    if (s.firstMonthAverage && stats.average > s.firstMonthAverage + 2) {
        return {
            title: "Le Roi du Comeback",
            icon: RefreshCcw,
            description: "Le début de saison était compliqué. On a eu peur. Et puis tu as enclenché la seconde et tu as doublé tout le monde avant la ligne d'arrivée.",
            condition: "Moyenne finale supérieure de 2 points à celle du premier mois",
            color: "text-emerald-400",
            bg: "bg-emerald-500/10 border-emerald-500/20",
            gradient: "from-emerald-500 to-green-500"
        };
    }

    // 3. Le "All In"
    // Assuming we might have worstSubjectAverage in the future
    if (stats.bestSubjects.length > 0 && s.worstSubjectAverage && (stats.bestSubjects[0].value - s.worstSubjectAverage > 5)) {
        return {
            title: "Le \"All In\"",
            icon: Dices,
            description: "Tu as choisi tes batailles. Pourquoi essayer d'être moyen partout quand on peut tout miser sur ses points forts ? Une stratégie risquée, mais payante.",
            condition: "Plus de 5 points d'écart entre ta meilleure et ta pire matière",
            color: "text-red-400",
            bg: "bg-red-500/10 border-red-500/20",
            gradient: "from-red-500 to-rose-500"
        };
    }

    // 4. La Masterclass
    if (stats.average > 16) {
        return {
            title: "La Masterclass",
            icon: Crown,
            description: "À ce niveau-là, ce n'est plus des révisions, c'est une démonstration. Tu as plié l'année scolaire avec une facilité déconcertante.",
            condition: "Moyenne générale supérieure à 16/20",
            color: "text-yellow-400",
            bg: "bg-yellow-500/10 border-yellow-500/20",
            gradient: "from-yellow-400 to-amber-400"
        };
    }

    // 5. L'Imprévisible
    // Need stdDev > 4 in > 25% subjects
    if (s.stdDevHighCount && s.totalSubjects && (s.stdDevHighCount / s.totalSubjects >= 0.25)) {
        return {
            title: "L'Imprévisible",
            icon: Shuffle,
            description: "Capable du génie absolu comme du ratage total au sein d'une même matière. Avec toi, c'est tout ou rien. Tes bulletins sont plus surprenants qu'une fin de saison Netflix.",
            condition: "Des résultats très variables dans plus d'un quart de tes matières",
            color: "text-purple-400",
            bg: "bg-purple-500/10 border-purple-500/20",
            gradient: "from-purple-500 to-violet-500"
        };
    }

    // 6. La Précision
    // Need stdDev < 2 in > 50% subjects
    if (s.stdDevLowCount && s.totalSubjects && (s.stdDevLowCount / s.totalSubjects >= 0.5)) {
        return {
            title: "La Précision",
            icon: Crosshair,
            description: "Une régularité chirurgicale. Quand tu vises une note, tu l'atteins à chaque fois. Pas de mauvaises surprises, tu es une valeur sûre.",
            condition: "Des résultats très réguliers dans la majorité de tes matières",
            color: "text-blue-400",
            bg: "bg-blue-500/10 border-blue-500/20",
            gradient: "from-blue-400 to-cyan-400"
        };
    }

    // 7. Légende d'Avermate
    if (stats.gradesCount >= 40) {
        return {
            title: "Légende d'Avermate",
            icon: Gem,
            description: "On hésite à te donner les clés du serveur. Ton suivi est tellement complet que tu connais ta moyenne mieux que tes profs. Tu ne fais plus qu'un avec l'application.",
            condition: "Plus de 40 notes ajoutées sur l'année",
            color: "text-cyan-400",
            bg: "bg-cyan-500/10 border-cyan-500/20",
            gradient: "from-cyan-400 to-sky-400"
        };
    }

    // 8. Avermatien
    if (stats.gradesCount >= 15) {
        return {
            title: "Avermatien",
            icon: UserCheck,
            description: "Membre certifié de la famille. Ni trop, ni trop peu. Tu gères ton année avec le sérieux d'un comptable, mais le style en plus. C'est carré.",
            condition: "Plus de 15 notes ajoutées sur l'année",
            color: "text-green-400",
            bg: "bg-green-500/10 border-green-500/20",
            gradient: "from-green-400 to-emerald-400"
        };
    }

    // 9. Le Touriste (Default fallback)
    return {
        title: "Le Touriste",
        icon: Plane,
        description: "Tu as vu de la lumière, tu es rentré, tu as mis quelques notes et tu es reparti. On ne sait pas si c'est de la confiance absolue ou du talent, mais on adore l'audace.",
        condition: "Moins de 15 notes ajoutées sur l'année",
        color: "text-pink-400",
        bg: "bg-pink-500/10 border-pink-500/20",
        gradient: "from-pink-400 to-rose-400"
    };
};

function AwardIntroSlide({ stats }: SlideProps) {
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
                    We've analyzed your performance...
                </motion.p>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.5 }}
                    className="text-3xl font-medium"
                >
                    And found the perfect title for you.
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

function AwardRevealSlide({ stats }: SlideProps) {
    const award = useMemo(() => getAward(stats), [stats]);

    useEffect(() => {
        const timer = setTimeout(() => {
            confetti({
                particleCount: 200,
                spread: 100,
                origin: { y: 0.6 },
                colors: ['#FFD700', '#FFA500', '#ffffff']
            });
        }, 600);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-black text-white relative overflow-hidden">
            {/* Shiny Gold Background */}
            <div className="absolute inset-0 bg-gradient-to-tr from-yellow-400/50 via-black to-yellow-400/50" />

            {/* Header Text */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="relative z-10 mb-8 flex flex-col items-center gap-2"
            >
                <div className="p-3 bg-yellow-500/20 rounded-full border border-yellow-500/30 mb-2">
                    <Trophy className="w-6 h-6 text-yellow-400" />
                </div>
                <h2 className="text-2xl font-bold text-yellow-100">Your Award</h2>
            </motion.div>

            <motion.div
                initial={{ scale: 0.5, opacity: 0, rotateY: 90 }}
                animate={{ scale: 1, opacity: 1, rotateY: 0 }}
                transition={{ duration: 0.8, type: "spring", bounce: 0.3 }}
                className={cn("relative z-10 rounded-xl p-6 w-full max-w-sm shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center justify-between border bg-[#161b22]", award.bg)}
            >
                <div className="flex flex-col items-start text-left">
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6 }}
                        className={cn("text-xs font-bold uppercase tracking-wider mb-1", award.color)}
                    >
                        {award.title}
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7 }}
                        className="text-2xl font-bold text-white leading-tight"
                    >
                        {award.description.split('.')[0]}
                    </motion.div>
                </div>
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.8, type: "spring" }}
                >
                    <award.icon className={cn("w-10 h-10", award.color)} />
                </motion.div>
            </motion.div>

            <motion.p 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.5 }}
                className="relative z-10 mt-8 text-sm text-yellow-200/80 max-w-xs"
            >
                {award.condition}
            </motion.p>
        </div>
    );
}

function OutroSlide({ year, stats, onClose, userName, userAvatar }: SlideProps) {
    const recapRef = useRef<HTMLDivElement>(null);
    const [isSharing, setIsSharing] = useState(false);

    const award = useMemo(() => getAward(stats), [stats]);

    const weeks = useMemo(() => {
        const result = [];
        const yearNum = parseInt(year);
        const targetYear = isNaN(yearNum) ? new Date().getFullYear() : yearNum;

        const startDate = new Date(targetYear, 0, 1);
        const now = new Date();
        const isCurrentYear = now.getFullYear() === targetYear;
        const endDate = isCurrentYear ? now : new Date(targetYear, 11, 31);

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
    }, [stats.heatmap, year]);

    const handleShare = async () => {
        if (!recapRef.current || isSharing) return;

        setIsSharing(true);
        try {
            const canvas = await html2canvas(recapRef.current, {
                backgroundColor: '#0d1117',
                scale: 2,
                useCORS: true,
                allowTaint: true,
            });

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    setIsSharing(false);
                    return;
                }

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
                        downloadImage(canvas);
                    }
                } else {
                    downloadImage(canvas);
                }
                setIsSharing(false);
            }, 'image/png');
        } catch (err) {
            console.error("Error generating image:", err);
            setIsSharing(false);
        }
    };

    const downloadImage = (canvas: HTMLCanvasElement) => {
        const link = document.createElement('a');
        link.download = `avermate-recap-${year}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    return (
        <div className="flex flex-col items-center h-full text-center p-4 bg-[#0d1117] text-white overflow-hidden">
            {/* Recap content to be captured */}
            <div ref={recapRef} className="w-full h-full flex flex-col bg-[#0d1117] p-4">
                {/* Header */}
                <div className="flex items-center gap-3 w-full mb-4 shrink-0">
                    {userAvatar ? (
                        <img src={userAvatar} alt={userName || ""} className="w-12 h-12 rounded-full object-cover border-2 border-white/20" />
                    ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center font-bold text-lg">
                            {year.slice(-2)}
                        </div>
                    )}
                    <div className="text-left">
                        {userName && <div className="font-bold text-lg">{userName}</div>}
                        <div className="text-xs text-[#8b949e]">{year} Recap • Avermate</div>
                    </div>
                </div>

                {/* Mini Heatmap Visual (Real Data) */}
                <div className="w-full bg-[#161b22] border border-white/10 rounded-2xl p-4 mb-4 shrink-0">
                    <div className="w-full">
                        <div
                            className="flex gap-[2px] w-full"
                        >
                            {weeks.map((week, weekIndex) => (
                                <div
                                    key={weekIndex}
                                    className="flex-1 flex flex-col gap-[2px]"
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
                    <div className="text-left text-xs text-[#8b949e] mt-2">
                        {stats.gradesCount} grades in {year}
                    </div>
                </div>

                {/* Grid Layout - Flex grow to fill space */}
                <div className="grid grid-cols-2 auto-rows-fr gap-3 w-full mb-4 flex-1">
                    {/* Award Card */}
                    <div className={cn("col-span-2 rounded-xl p-4 flex items-center justify-between border bg-[#161b22]", award.bg)}>
                        <div className="flex flex-col items-start text-left">
                            <div className={cn("text-xs font-bold uppercase tracking-wider mb-1", award.color)}>
                                {award.title}
                            </div>
                            <div className="text-2xl sm:text-3xl font-bold text-white leading-tight">
                                {award.description.split('.')[0]}
                            </div>
                        </div>
                        <award.icon className={cn("w-10 h-10", award.color)} />
                    </div>

                    <StatCard
                        icon={Trophy}
                        title="Universal Rank"
                        value={`Top ${stats.topPercentile}%`}
                        colorClass="text-yellow-400"
                    />
                    <StatCard
                        icon={Zap}
                        title="Longest Streak"
                        value={stats.longestStreak}
                        colorClass="text-emerald-400"
                    />
                    <StatCard
                        icon={Activity}
                        title="Total Grades"
                        value={stats.gradesCount}
                        colorClass="text-pink-400"
                    />
                    <StatCard
                        icon={Calendar}
                        title="Most Active Month"
                        value={stats.mostActiveMonth.month}
                        colorClass="text-purple-400"
                    />
                    <StatCard
                        icon={Star}
                        title="Total Points"
                        value={stats.gradesSum.toFixed(0)}
                        colorClass="text-blue-400"
                    />
                    <StatCard
                        icon={Target}
                        title="Global Average"
                        value={stats.average?.toFixed(2) || "N/A"}
                        colorClass="text-teal-400"
                    />
                    <StatCard
                        icon={Rocket}
                        title="Top Subject"
                        value={stats.bestSubjects[0]?.name || "N/A"}
                        colorClass="text-cyan-400"
                        truncate={true}
                        className="col-span-2"
                    />
                </div>

                <div className="text-sm text-[#8b949e] shrink-0">
                    avermate.fr
                </div>
            </div>

            {/* Buttons (not captured) */}
            <div className="flex gap-3 w-full mt-4 mb-4 shrink-0">
                <Button
                    className="flex-1 bg-white hover:bg-gray-200 text-black border-none h-12 rounded-xl font-bold"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleShare();
                    }}
                    disabled={isSharing}
                >
                    <Share2 className="w-4 h-4 mr-2" /> {isSharing ? "Generating..." : "Share Image"}
                </Button>

                <Button
                    variant="outline"
                    className="flex-1 border-white/20 bg-[#21262d] hover:bg-[#30363d] text-white h-12 rounded-xl"
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                >
                    Close
                </Button>
            </div>
        </div>
    );
}

// ... Main Story Component ... (keep as is)
export function YearReviewStory({ stats, year, isOpen, onClose, userName, userAvatar }: SlideProps & { isOpen: boolean }) {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [paused, setPaused] = useState(false);
    const [progress, setProgress] = useState(0);
    const [isNavigating, setIsNavigating] = useState(false);
    // Track animated bar states: { index: targetProgress }
    const [animatedBars, setAnimatedBars] = useState<Record<number, number>>({});
    const [stepDuration, setStepDuration] = useState(120); // Dynamic per-step duration
    const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const slides = useMemo(() => [
        { component: IntroSlide, duration: 4000 },
        { component: StatsSlide, duration: 6000 },
        { component: HeatmapSlide, duration: 6000 },
        { component: StreakSlide, duration: 5000 },
        { component: PrimeTimeSlide, duration: 5000 },
        { component: SubjectsSlide, duration: 7000 },
        { component: AwardIntroSlide, duration: 3000 },
        { component: AwardRevealSlide, duration: 6000 },
        { component: PercentileSlide, duration: 6000 },
        { component: OutroSlide, duration: 10000 }, // Last slide: progress fills but doesn't auto-close
    ], []);

    const isLastSlide = currentSlide === slides.length - 1;

    const CurrentComponent = slides[currentSlide].component;

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

    return (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
            {/* Desktop Close Button */}
            <button
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="absolute top-4 right-4 z-[60] text-white/50 hover:text-white p-2"
                aria-label="Close"
            >
                <X className="w-8 h-8" />
            </button>

            {/* Desktop Navigation Buttons */}
            <button
                onClick={(e) => { e.stopPropagation(); prevSlide(); }}
                className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 z-[60] text-white/50 hover:text-white p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                aria-label="Previous slide"
                disabled={currentSlide === 0}
            >
                <ChevronLeft className="w-6 h-6" />
            </button>

            <button
                onClick={(e) => { e.stopPropagation(); nextSlide(); }}
                className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-[60] text-white/50 hover:text-white p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                aria-label="Next slide"
            >
                <ChevronRight className="w-6 h-6" />
            </button>

            {/* Mobile-style container */}
            <div
                className="relative w-full h-full md:w-auto md:h-[85vh] md:aspect-[9/16] md:rounded-3xl overflow-hidden bg-black shadow-2xl cursor-pointer select-none"
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
                                aria-label={`Go to slide ${index + 1}`}
                            >
                                <div className="h-1 w-full bg-white/30 rounded-full overflow-hidden group-hover:bg-white/40 transition-colors">
                                    <div
                                        className="h-full bg-white"
                                        style={{
                                            width: `${barProgress}%`,
                                            // Use linear timing during navigation so bars feel like one continuous progress
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
                    className="absolute top-8 right-4 z-20 text-white/70 hover:text-white p-2 bg-black/30 rounded-full backdrop-blur-sm"
                    aria-label={paused ? "Play" : "Pause"}
                >
                    {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
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
                                onClose={onClose}
                                userName={userName}
                                userAvatar={userAvatar}
                            />
                        </motion.div>
                    </AnimatePresence>
                </div>

            </div>
        </div>
    );
}
