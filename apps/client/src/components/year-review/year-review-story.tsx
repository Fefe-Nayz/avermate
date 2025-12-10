"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Share2, Sparkles, Trophy, TrendingUp, Calendar, Zap, Award, Star, Activity, Rocket, Pause, Play } from "lucide-react";
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

function IntroSlide({ year, userName, userAvatar }: SlideProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
            <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
            >
                {userAvatar ? (
                    <img 
                        src={userAvatar} 
                        alt={userName || "User"} 
                        className="w-24 h-24 rounded-full mx-auto mb-6 border-4 border-white/30 object-cover"
                    />
                ) : (
                    <div className="w-24 h-24 bg-white/20 rounded-full mx-auto mb-6 flex items-center justify-center backdrop-blur-sm">
                        <Sparkles className="w-12 h-12 text-yellow-300" />
                    </div>
                )}
                {userName && <p className="text-lg opacity-80 mb-2">{userName}</p>}
                <h1 className="text-5xl font-black mb-4 tracking-tight">{year}</h1>
                <h2 className="text-2xl font-bold mb-2">Year in Review</h2>
                <p className="text-xl opacity-80">Ready to see your stats?</p>
            </motion.div>
        </div>
    );
}

function StatsSlide({ stats }: SlideProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-gradient-to-br from-blue-500 to-cyan-500 text-white">
            <div className="grid grid-cols-1 gap-8 w-full max-w-md">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-white/10 backdrop-blur-md rounded-2xl p-6"
                >
                    <h3 className="text-xl mb-2">Grades Entered</h3>
                    <p className="text-5xl font-bold">{stats.gradesCount}</p>
                </motion.div>
                
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="bg-white/10 backdrop-blur-md rounded-2xl p-6"
                >
                    <h3 className="text-xl mb-2">Total Points</h3>
                    <p className="text-5xl font-bold">{stats.gradesSum.toFixed(1)}</p>
                    <p className="text-sm opacity-70 mt-2">Accumulated /20</p>
                </motion.div>
            </div>
        </div>
    );
}

function HeatmapSlide({ stats, year, userName, userAvatar }: SlideProps) {
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
        
        // Pad beginning to align with first day of week
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

    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-4 bg-[#0d1117] text-white">
             <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 w-full"
             >
                <div className="flex items-center justify-center gap-3 mb-4">
                    {userAvatar ? (
                        <img src={userAvatar} alt={userName || ""} className="w-12 h-12 rounded-full border-2 border-white/20 object-cover" />
                    ) : (
                        <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white/20">
                            <div className="w-full h-full bg-gradient-to-br from-green-400 to-blue-500" />
                        </div>
                    )}
                    <div className="text-left">
                        {userName && <div className="font-bold text-lg">{userName}</div>}
                        <div className="text-sm opacity-60">{year} Year in Grades</div>
                    </div>
                </div>
             </motion.div>

             <motion.div 
                 initial={{ opacity: 0, scale: 0.95 }}
                 animate={{ opacity: 1, scale: 1 }}
                 transition={{ delay: 0.2 }}
                 className="w-full bg-[#161b22] p-4 rounded-2xl border border-white/10 shadow-2xl flex flex-col items-center"
             >
                 {/* Flexible container for the grid */}
                 <div className="w-full flex justify-center">
                     <div 
                        className="flex justify-center"
                        style={{ 
                            maxWidth: '100%',
                        }}
                     >
                        {weeks.map((week, weekIndex) => (
                            <div key={weekIndex} className="flex flex-col gap-[1px] mr-[1px] last:mr-0">
                                {week.map((day, dayIndex) => (
                                    <div 
                                       key={`${weekIndex}-${dayIndex}`}
                                       className={cn(
                                           "rounded-[0.5px] w-[3px] h-[3px] min-[370px]:w-[4px] min-[370px]:h-[4px] sm:w-[5px] sm:h-[5px]",
                                           !day ? "bg-transparent" :
                                            day.count === 0 ? "bg-[#161b22] border border-white/5" : 
                                            day.count === 1 ? "bg-[#0e4429]" :
                                            day.count <= 3 ? "bg-[#006d32]" :
                                            "bg-[#39d353]"
                                        )}
                                        title={day ? `${day.dateStr}: ${day.count} grades` : ""}
                                     />
                                 ))}
                             </div>
                         ))}
                     </div>
                 </div>
                 <div className="text-left mt-4 text-sm text-[#8b949e] w-full">
                    {stats.gradesCount} grades in {year}
                 </div>
             </motion.div>

             <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="mt-8"
             >
                <h3 className="text-lg opacity-80 mb-2">Most Active Month</h3>
                <div className="text-4xl font-black uppercase tracking-wider">
                    {stats.mostActiveMonth.month}
                </div>
                <p className="text-sm mt-2 opacity-60">{stats.mostActiveMonth.count} grades entered</p>
             </motion.div>
        </div>
    );
}

function StreakSlide({ stats }: SlideProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-gradient-to-br from-orange-500 to-red-500 text-white">
            <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
            >
                <div className="text-8xl mb-4">🔥</div>
            </motion.div>
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
            >
                <h2 className="text-3xl font-bold">On Fire!</h2>
                <p className="text-6xl font-black my-6">{stats.longestStreak}</p>
                <p className="text-xl max-w-xs mx-auto">Consecutive grades that increased your average</p>
            </motion.div>
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
                Peak reached on<br/><strong>{date}</strong>
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
             {/* Background animated gradient */}
             <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900 via-[#0a0a0a] to-black opacity-80" />
             
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
function StatCard({ icon: Icon, title, value, colorClass, truncate = false }: { icon: any, title: string, value: string | number, colorClass: string, truncate?: boolean }) {
    return (
        <div className="bg-[#161b22] border border-white/10 rounded-xl p-4 flex flex-col items-start h-full">
            <div className="flex items-center gap-2 mb-2">
                <Icon className={cn("w-4 h-4", colorClass)} />
                <span className="text-xs text-gray-400 font-medium">{title}</span>
            </div>
            <div className={cn("text-2xl font-bold mt-auto", colorClass, truncate && "truncate w-full text-left")}>{value}</div>
        </div>
    );
}

function OutroSlide({ year, stats, onClose, userName, userAvatar }: SlideProps) {
    const recapRef = useRef<HTMLDivElement>(null);
    const [isSharing, setIsSharing] = useState(false);

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
        <div className="flex flex-col items-center h-full text-center p-4 bg-[#0d1117] text-white overflow-y-auto">
            {/* Recap content to be captured */}
            <div ref={recapRef} className="w-full bg-[#0d1117] p-4">
                {/* Header */}
                <div className="flex items-center gap-3 w-full mb-6">
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
                <div className="w-full bg-[#161b22] border border-white/10 rounded-2xl p-4 mb-4">
                    <div className="w-full flex justify-center">
                        <div 
                            className="flex justify-center"
                            style={{ 
                                maxWidth: '100%',
                            }}
                        >
                            {weeks.map((week, weekIndex) => (
                                 <div key={weekIndex} className="flex flex-col gap-[1px] mr-[1px] last:mr-0">
                                     {week.map((day, dayIndex) => (
                                         <div 
                                            key={`${weekIndex}-${dayIndex}`}
                                            className={cn(
                                                "rounded-full w-[3px] h-[3px] min-[370px]:w-[4px] min-[370px]:h-[4px] sm:w-[5px] sm:h-[5px]",
                                                !day ? "bg-transparent" :
                                                day.count === 0 ? "bg-[#161b22] border border-white/10" : 
                                                day.count === 1 ? "bg-[#0e4429]" :
                                                day.count <= 3 ? "bg-[#006d32]" :
                                                "bg-[#39d353]"
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

                {/* Grid Layout */}
                <div className="grid grid-cols-2 gap-3 w-full mb-4">
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
                    {/* Placeholder card */}
                    <div className="bg-[#161b22] border border-white/10 rounded-xl p-4 flex flex-col items-start h-full opacity-50">
                        <div className="flex items-center gap-2 mb-2">
                            <Sparkles className="w-4 h-4 text-gray-500" />
                            <span className="text-xs text-gray-500 font-medium">Coming Soon</span>
                        </div>
                        <div className="text-2xl font-bold mt-auto text-gray-500">...</div>
                    </div>
                    <StatCard 
                        icon={Rocket} 
                        title="Top Subject" 
                        value={stats.bestSubjects[0]?.name || "N/A"} 
                        colorClass="text-cyan-400" 
                        truncate={true}
                    />
                    <StatCard 
                        icon={Award} 
                        title="Best Avg" 
                        value={stats.bestSubjects[0]?.value.toFixed(2) || "0"} 
                        colorClass="text-indigo-400" 
                    />
                </div>

                <div className="text-xs text-[#8b949e]">
                    avermate.com
                </div>
            </div>

            {/* Buttons (not captured) */}
            <div className="flex gap-3 w-full mt-4 mb-4">
                 <Button 
                    className="flex-1 bg-[#238636] hover:bg-[#2ea043] text-white border-none h-12 rounded-xl font-bold"
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
    const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const slides = useMemo(() => [
        { component: IntroSlide, duration: 4000 },
        { component: StatsSlide, duration: 6000 },
        { component: HeatmapSlide, duration: 6000 },
        { component: StreakSlide, duration: 5000 },
        { component: PrimeTimeSlide, duration: 5000 },
        { component: SubjectsSlide, duration: 7000 },
        { component: PercentileSlide, duration: 6000 },
        { component: OutroSlide, duration: 1000000 },
    ], []);

    const CurrentComponent = slides[currentSlide].component;

    // Reset to first slide when opening
    useEffect(() => {
        if (isOpen) {
            setCurrentSlide(0);
            setProgress(0);
            setPaused(false);
        }
    }, [isOpen]);

    const goToSlide = useCallback((index: number) => {
        if (index >= 0 && index < slides.length) {
            setCurrentSlide(index);
            setProgress(0);
        }
    }, [slides.length]);

    const nextSlide = useCallback(() => {
        if (currentSlide < slides.length - 1) {
            goToSlide(currentSlide + 1);
        } else {
            onClose();
        }
    }, [currentSlide, slides.length, onClose, goToSlide]);

    const prevSlide = useCallback(() => {
        if (currentSlide > 0) {
            goToSlide(currentSlide - 1);
        }
    }, [currentSlide, goToSlide]);

    // Progress tracking
    useEffect(() => {
        if (paused || !isOpen) {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }
            return;
        }

        const duration = slides[currentSlide].duration;
        const intervalTime = 50;
        const increment = (intervalTime / duration) * 100;

        setProgress(0);
        
        progressIntervalRef.current = setInterval(() => {
            setProgress(prev => {
                const next = prev + increment;
                if (next >= 100) {
                    nextSlide();
                    return 0;
                }
                return next;
            });
        }, intervalTime);

        return () => {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }
        };
    }, [currentSlide, paused, isOpen, slides, nextSlide]);

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
                className="relative w-full h-full md:w-[400px] md:h-[80vh] md:rounded-3xl overflow-hidden bg-black shadow-2xl cursor-pointer select-none"
                onClick={handleClick}
            >
                
                {/* Progress Bars */}
                <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-2">
                    {slides.map((_, index) => (
                        <div key={index} className="h-1 flex-1 bg-white/30 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-white transition-all duration-75 ease-linear"
                                style={{ 
                                    width: index < currentSlide ? '100%' : 
                                           index === currentSlide ? `${progress}%` : '0%'
                                }}
                            />
                        </div>
                    ))}
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
