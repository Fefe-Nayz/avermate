"use client"

import Image from "next/image"
import {
  motion,
  AnimatePresence,
  animate,
  frameData,
  useMotionValue,
  useTransform,
  MotionGlobalConfig,
} from "motion/react"
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type CSSProperties,
  type RefObject,
} from "react"
import {
  X,
  ChevronLeft,
  ChevronRight,
  Share2,
  Trophy,
  TrendingUp,
  Calendar,
  Zap,
  Star,
  Activity,
  Rocket,
  Pause,
  Play,
  Crown,
  Target,
  Scale,
  RefreshCcw,
  Dices,
  Shuffle,
  Crosshair,
  Gem,
  UserCheck,
  Plane,
  type LucideIcon,
} from "lucide-react"
import type { AwardKind, Year, YearReview } from "@avermate/core"
import { useMutation } from "@tanstack/react-query"
import { useAuthenticatedUser } from "@/components/authenticated-user"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import confetti from "canvas-confetti"
import { toPng } from "@jpinsonneau/html-to-image"
import LightPillar from "@/components/LightPillar"
import { useExtracted, useFormatter } from "next-intl"
import { orpc } from "@/lib/orpc"
import {
  calculateYearReviewLayout,
  YEAR_REVIEW_CANONICAL_HEIGHT,
  YEAR_REVIEW_CANONICAL_WIDTH,
} from "./year-review-layout"
import { buildYearReviewPath } from "./year-review-path"

// --- Canonical Size for Stories ---
// The story is designed for this fixed resolution and scaled to fit any screen
const CANONICAL_WIDTH = YEAR_REVIEW_CANONICAL_WIDTH
const CANONICAL_HEIGHT = YEAR_REVIEW_CANONICAL_HEIGHT
const CANONICAL_SCALE = 20

type AwardType = AwardKind

type AwardData = {
  title: string
  icon: string
  description: string
  condition: string
  color: string
  bg: string
  gradient: string
}

type YearReviewStats = {
  gradesCount: number
  gradesSum: number
  heatmap: Record<string, number>
  mostActiveMonth: { month: string; count: number }
  mostActiveDay: { day: string; count: number }
  longestStreak: number
  primeTime: { date: Date; value: number }
  averageSeries: Array<{ date: Date; value: number }>
  bestSubjects: Array<{ name: string; value: number }>
  bestProgression: { subject: string; value: number }
  topPercentile: number
  average: number
  awardType: AwardType
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function seededFraction(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

// Hook to calculate zoom level - cross-browser (Chrome + Firefox)
function useZoomLevel() {
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const updateZoom = () => {
      let detectedZoom = 1

      // Detect browser
      const isFirefox =
        typeof navigator !== "undefined" &&
        navigator.userAgent.toLowerCase().includes("firefox")

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
        const dpr = window.devicePixelRatio || 1
        detectedZoom = dpr // nativeDPR = 1, so zoom = dpr / 1 = dpr
      } else if (
        window.outerWidth &&
        window.innerWidth &&
        window.outerWidth > 0
      ) {
        // Chrome and other browsers: outerWidth/innerWidth works reliably
        detectedZoom = window.outerWidth / window.innerWidth
      }

      // Clamp to reasonable values
      detectedZoom = Math.max(0.1, Math.min(10, detectedZoom))

      setZoom(detectedZoom)
    }

    updateZoom()
    window.addEventListener("resize", updateZoom)

    // Also listen to visualViewport resize if available
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateZoom)
    }

    return () => {
      window.removeEventListener("resize", updateZoom)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", updateZoom)
      }
    }
  }, [])

  return zoom
}

// The browser resolves env(safe-area-inset-*) on this frame. Its children can
// therefore use safe-area-local coordinates without parsing CSS values in JS.
function useStoryLayout(
  safeAreaRef: RefObject<HTMLDivElement | null>,
  isOpen: boolean
) {
  const zoom = useZoomLevel()

  const [layout, setLayout] = useState(() =>
    calculateYearReviewLayout({
      viewportWidth: CANONICAL_WIDTH,
      safeAreaWidth: CANONICAL_WIDTH,
      safeAreaHeight: CANONICAL_HEIGHT,
      zoom: 1,
    })
  )

  useEffect(() => {
    if (!isOpen) return

    const updateLayout = () => {
      const safeArea = safeAreaRef.current
      if (!safeArea) return

      const safeAreaRect = safeArea.getBoundingClientRect()
      setLayout(
        calculateYearReviewLayout({
          viewportWidth: window.innerWidth,
          safeAreaWidth: safeAreaRect.width,
          safeAreaHeight: safeAreaRect.height,
          zoom,
        })
      )
    }

    updateLayout()

    // Listen to resize events
    window.addEventListener("resize", updateLayout)

    // Also use ResizeObserver for more reliable updates
    const resizeObserver = new ResizeObserver(updateLayout)
    const safeArea = safeAreaRef.current
    if (safeArea) resizeObserver.observe(safeArea)

    return () => {
      window.removeEventListener("resize", updateLayout)
      resizeObserver.disconnect()
    }
  }, [isOpen, safeAreaRef, zoom])

  return layout
}

// Animated Music Icon Component
function MusicBarsIcon({
  isMuted,
  className,
}: {
  isMuted: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex h-4 w-4 items-end justify-center gap-[2px]",
        className
      )}
    >
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-1 rounded-full bg-current"
          animate={
            isMuted
              ? { height: 4 }
              : {
                  height: [8, 14, 8, 12, 8],
                }
          }
          transition={
            isMuted
              ? { duration: 0.2 }
              : {
                  duration: 0.6 + i * 0.1,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.15,
                }
          }
          style={{ minHeight: 4 }}
        />
      ))}
    </div>
  )
}

// Ambilight Canvas Component - YouTube-style ambient glow
// CSS-based Ambilight effect that works with any DOM element
// Creates a blurred, scaled-up clone of the story behind it
function AmbilightWrapper({ children }: { children: React.ReactNode }) {
  // Ambilight settings - increased for more dramatic glow
  const BLUR_AMOUNT = 100 // px - increased from 80
  const GLOW_SCALE = 1.25 // How much larger the glow is vs the story - increased from 1.15
  const GLOW_OPACITY = 0.7 // increased from 0.6
  const SATURATION_BOOST = 1.5 // increased from 1.3

  return (
    <div className="relative">
      {/* Ambilight layer - blurred clone positioned behind */}
      <div
        data-ambilight-clone
        aria-hidden="true"
        inert
        className="pointer-events-none absolute"
        style={{
          inset: 0,
          transform: `scale(${GLOW_SCALE})`,
          filter: `blur(${BLUR_AMOUNT}px) saturate(${SATURATION_BOOST})`,
          opacity: GLOW_OPACITY,
          zIndex: 0,
        }}
      >
        {/* Clone of children rendered blurred behind */}
        <div
          style={{
            width: CANONICAL_WIDTH,
            height: CANONICAL_HEIGHT,
            overflow: "hidden",
            borderRadius: 24,
          }}
        >
          {children}
        </div>
      </div>

      {/* Actual story content on top */}
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  )
}

// --- Slides ---

interface SlideProps {
  stats: YearReviewStats
  year: string
  yearStartDate?: Date
  yearEndDate?: Date
  onClose: () => void
  userName?: string
  userAvatar?: string
  /** The story's pause is real: slides freeze whatever they run themselves. */
  paused?: boolean
}

interface CanonicalYearReviewStoryProps {
  stats: YearReviewStats
  year: string
  yearStartDate?: Date
  yearEndDate?: Date
  onClose: () => void
  userName?: string
  userAvatar?: string
  isOpen: boolean
}

interface YearReviewStoryProps {
  review: YearReview
  reviewKey?: string
  year: Year
  onClose: () => void
}

/**
 * True while the story is paused. The count-ups run through the motion
 * library's own scheduler, out of reach of both the CSS pause class and the
 * Web Animations API — they have to be told.
 */
const StoryPausedContext = createContext(false)

function CountUp({
  value,
  duration = 2,
  delay = 0,
  decimals = 0,
  ease = "easeOut",
}: {
  value: number
  duration?: number
  delay?: number
  decimals?: number
  ease?: "easeOut" | "circOut"
}) {
  const paused = useContext(StoryPausedContext)
  const motionValue = useMotionValue(0)
  const rounded = useTransform(motionValue, (latest) =>
    latest.toFixed(decimals)
  )
  const controlsRef = useRef<ReturnType<typeof animate> | null>(null)

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration,
      delay,
      ease,
    })
    controlsRef.current = controls
    return () => {
      controlsRef.current = null
      controls.stop()
    }
  }, [value, duration, delay, motionValue, ease])

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    if (paused) controls.pause()
    else controls.play()
  }, [paused])

  return <motion.span>{rounded}</motion.span>
}

function IntroSlide({ year, userName, userAvatar }: SlideProps) {
  const t = useExtracted()
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[#0a0a0a] p-4 text-center text-white">
      {/* Animated gradient orbs - sized for canonical viewport */}
      <motion.div
        className="absolute top-1/4 -left-16 h-48 w-48 rounded-full bg-emerald-500/30 blur-[60px]"
        animate={{
          x: [0, 20, 0],
          y: [0, -15, 0],
          scale: [1, 1.1, 1],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-16 bottom-1/4 h-56 w-56 rounded-full bg-cyan-500/25 blur-[80px]"
        animate={{
          x: [0, -25, 0],
          y: [0, 20, 0],
          scale: [1, 1.2, 1],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute top-1/2 left-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-400/20 blur-[100px]"
        animate={{
          scale: [1, 1.3, 1],
          opacity: [0.2, 0.35, 0.2],
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
            style={{
              margin: -12,
              boxShadow: "inset 0 0 0 2px rgba(52, 211, 153, 0.5)",
            }}
            animate={{ scale: [1.15, 1.3, 1.15], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              margin: -20,
              boxShadow: "inset 0 0 0 1px rgba(34, 211, 238, 0.4)",
            }}
            animate={{ scale: [1.2, 1.4, 1.2], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 2.5, repeat: Infinity, delay: 0.3 }}
          />
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              margin: -28,
              boxShadow: "inset 0 0 0 1px rgba(45, 212, 191, 0.2)",
            }}
            animate={{ scale: [1.25, 1.5, 1.25], opacity: [0.2, 0, 0.2] }}
            transition={{ duration: 3, repeat: Infinity, delay: 0.6 }}
          />

          {userAvatar ? (
            <div className="h-20 w-20 rounded-xl p-1 shadow-[0_0_30px_rgba(16,185,129,0.4)]">
              <Image
                unoptimized
                src={userAvatar}
                alt={userName || t("User")}
                width={80}
                height={80}
                className="h-full w-full rounded-[10px] object-cover"
              />
            </div>
          ) : (
            <div className="h-20 w-20 rounded-xl p-1 shadow-[0_0_30px_rgba(16,185,129,0.4)]">
              <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[calc(theme(borderRadius.xl)-2px)] bg-[#0a0a0a]">
                <Image
                  src="/logo.svg"
                  alt="Avermate"
                  width={80}
                  height={80}
                  className="h-full w-full object-contain"
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
            className="mb-2 text-base font-medium text-gray-300"
          >
            {userName}
          </motion.p>
        )}

        {/* Year - Big dramatic reveal - sized for canonical viewport */}
        <motion.h1
          initial={{ opacity: 0, y: 30, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.5, duration: 0.6, type: "spring" }}
          className="mb-3 bg-gradient-to-r from-emerald-300 via-cyan-300 to-teal-300 bg-clip-text text-6xl font-black tracking-tight text-transparent drop-shadow-[0_0_20px_rgba(16,185,129,0.5)]"
        >
          {year}
        </motion.h1>

        {/* Subtitle */}
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mb-2 text-xl font-bold text-white"
        >
          {t("Year in Review")}
        </motion.h2>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ delay: 0.9 }}
          className="text-sm text-gray-400"
        >
          {t("Your academic journey, visualized")}
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
            className="text-[10px] tracking-widest text-gray-500 uppercase"
          >
            {t("Tap to continue")}
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}

function StatsSlide({ stats }: SlideProps) {
  const t = useExtracted()
  const [zoomOut, setZoomOut] = useState(false)

  // Animation values calibrated for canonical size (390x844)
  // Calculate dynamic offset to center on Grades bar
  // Layout: [GradesBar(80px)] [gap(32px)] [PointsBar(80px)]
  const SCALE = 2.8
  const BAR_WIDTH = 80 // w-20 = 5rem = 80px
  const GAP = 32 // gap-8 = 2rem = 32px
  const distanceToGradesCenter = GAP / 2 + BAR_WIDTH / 2 // 56px
  const xOffset = distanceToGradesCenter * SCALE // ~157px

  useEffect(() => {
    const timer = setTimeout(() => setZoomOut(true), 2200)
    return () => clearTimeout(timer)
  }, [])

  // Generate more speed lines for the tracking phase - spread across the whole screen
  const speedLines = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: `${(i / 24) * 100 + (seededFraction(i * 5 + 1) - 0.5) * 8}%`,
      delay: seededFraction(i * 5 + 2) * 0.8,
      duration: 0.4 + seededFraction(i * 5 + 3) * 0.5,
      height: 60 + seededFraction(i * 5 + 4) * 120,
      opacity: 0.3 + seededFraction(i * 5 + 5) * 0.4,
    }))
  }, [])

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[#0a0a0a] p-4 text-center text-white">
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
        className="absolute top-1/2 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/4 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(139, 92, 246, 0.3) 0%, rgba(139, 92, 246, 0) 70%)",
        }}
        animate={
          zoomOut ? { scale: 1.2, opacity: 0.6 } : { scale: 0.8, opacity: 0.4 }
        }
        transition={{ duration: 0.8 }}
      />

      {/* Speed lines during tracking phase - behind bar chart (z-0) */}
      <AnimatePresence>
        {!zoomOut &&
          speedLines.map((line) => (
            <motion.div
              key={line.id}
              className="absolute z-0 w-[1.5px] rounded-full bg-gradient-to-b from-transparent via-violet-400/60 to-transparent"
              style={{
                left: line.left,
                height: line.height,
              }}
              initial={{ y: -150, opacity: 0 }}
              animate={{
                y: ["-20%", "120%"],
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
        animate={
          zoomOut
            ? { scale: 1, y: 0, x: 0 } // Zoom out to full view
            : { scale: SCALE, y: 180, x: xOffset } // Track the growing bar upwards, keep centered on Grades
        }
        transition={
          zoomOut
            ? { duration: 0.8, type: "spring", bounce: 0.2 } // Zoom out transition
            : { duration: 2, ease: "easeOut" } // Tracking transition (matches bar growth)
        }
        className="relative z-10 flex h-64 w-full max-w-xs items-end justify-center gap-8"
      >
        {/* Grades Bar */}
        <div className="relative flex w-20 flex-col items-center gap-2">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={zoomOut ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            className="absolute -top-8 text-lg font-bold whitespace-nowrap text-violet-200"
          >
            {t("Grades")}
          </motion.div>

          <div
            className="relative flex h-64 w-full items-end overflow-hidden rounded-t-2xl bg-[#0a0a0a]"
            style={{ boxShadow: "inset 0 0 0 1px rgba(139, 92, 246, 0.2)" }}
          >
            {/* Growing Fill */}
            <motion.div
              initial={{ height: "0%" }}
              animate={{ height: "60%" }}
              transition={{ duration: 2, ease: "easeOut" }}
              className="relative w-full"
              style={{
                background:
                  "linear-gradient(to top, #7c3aed, #a78bfa, #c4b5fd)",
                boxShadow:
                  "0 0 30px rgba(139, 92, 246, 0.6), 0 0 60px rgba(139, 92, 246, 0.3)",
              }}
            >
              {/* Subtle shimmer effect - gentler, continues past the top */}
              {!zoomOut && (
                <motion.div
                  className="absolute inset-x-0 -top-[50%] bottom-0 bg-gradient-to-t from-transparent via-white/15 to-transparent"
                  style={{ height: "200%" }}
                  initial={{ y: "50%" }}
                  animate={{ y: "-100%" }}
                  transition={{ duration: 2.2, ease: "easeOut" }}
                />
              )}
              {/* Ticking Value on top of the bar */}
              <div className="absolute -top-10 left-1/2 w-24 -translate-x-1/2 text-center">
                <span className="text-3xl font-black text-white drop-shadow-[0_0_20px_rgba(139,92,246,0.8)]">
                  <CountUp value={stats.gradesCount} duration={2} />
                </span>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Points Bar */}
        <div className="relative flex w-20 flex-col items-center gap-2">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={zoomOut ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ delay: 0.1 }}
            className="absolute -top-8 text-lg font-bold whitespace-nowrap text-fuchsia-200"
          >
            {t("Points")}
          </motion.div>

          <div
            className="relative flex h-64 w-full items-end overflow-hidden rounded-t-2xl bg-[#0a0a0a]"
            style={{ boxShadow: "inset 0 0 0 1px rgba(236, 72, 153, 0.2)" }}
          >
            <motion.div
              initial={{ height: "0%" }}
              animate={zoomOut ? { height: "75%" } : { height: "0%" }}
              transition={{ duration: 1.5, ease: "easeOut", delay: 0.2 }}
              className="relative w-full"
              style={{
                background:
                  "linear-gradient(to top, #db2777, #f472b6, #fbcfe8)",
                boxShadow:
                  "0 0 30px rgba(236, 72, 153, 0.6), 0 0 60px rgba(236, 72, 153, 0.3)",
              }}
            >
              {zoomOut && (
                <div className="absolute -top-10 left-1/2 w-24 -translate-x-1/2 text-center">
                  <span className="text-2xl font-black text-white drop-shadow-[0_0_20px_rgba(236,72,153,0.8)]">
                    <CountUp
                      value={stats.gradesSum}
                      duration={1.5}
                      delay={0.2}
                      decimals={0}
                    />
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
        className="relative z-10 mx-auto mt-8 max-w-xs text-sm text-gray-400"
      >
        {t("Accumulated points throughout the year")}
      </motion.p>
    </div>
  )
}

function HeatmapSlide({
  stats,
  year,
  yearStartDate,
  yearEndDate,
  userName,
  userAvatar,
}: SlideProps) {
  const t = useExtracted()
  const [zoomOut, setZoomOut] = useState(false)
  const formatter = useFormatter()

  // Format the most active month using next-intl
  const formattedMostActiveMonth = useMemo(() => {
    const [yearNum, monthNum] = stats.mostActiveMonth.month
      .split("-")
      .map(Number)
    const date = new Date(yearNum, monthNum - 1, 1)
    return formatter.dateTime(date, { month: "long" })
  }, [stats.mostActiveMonth.month, formatter])

  const days = useMemo(() => {
    const result = []
    const now = new Date()

    // Use provided year dates or fall back to parsing year name
    let startDate: Date
    let endDate: Date

    if (yearStartDate && yearEndDate) {
      startDate = new Date(yearStartDate)
      // End date is either the year end date or current date, whichever is earlier
      endDate = new Date(
        Math.min(new Date(yearEndDate).getTime(), now.getTime())
      )
    } else {
      const yearNum = parseInt(year)
      const targetYear = isNaN(yearNum) ? now.getFullYear() : yearNum
      startDate = new Date(targetYear, 0, 1)
      const isCurrentYear = now.getFullYear() === targetYear
      endDate = isCurrentYear ? now : new Date(targetYear, 11, 31)
    }

    const currentDate = new Date(startDate)

    while (currentDate <= endDate) {
      const dateStr = localDayKey(currentDate)
      const count = stats.heatmap[dateStr] || 0
      result.push({
        date: new Date(currentDate),
        count,
        dateStr,
      })
      currentDate.setDate(currentDate.getDate() + 1)
    }
    return result
  }, [stats.heatmap, year, yearStartDate, yearEndDate])

  const weeks = useMemo(() => {
    const w: ((typeof days)[0] | null)[][] = []
    let currentWeek: ((typeof days)[0] | null)[] = Array(7).fill(null)

    if (days.length > 0) {
      const firstDayOfWeek = days[0].date.getDay()
      for (let i = 0; i < firstDayOfWeek; i++) {
        currentWeek[i] = null
      }
    }

    days.forEach((day) => {
      const dayIndex = day.date.getDay()
      currentWeek[dayIndex] = day

      if (dayIndex === 6) {
        w.push(currentWeek)
        currentWeek = Array(7).fill(null)
      }
    })

    if (currentWeek.some((d) => d !== null)) {
      w.push(currentWeek)
    }

    return w
  }, [days])

  // Trigger zoom out after horizontal pan completes
  useEffect(() => {
    const timer = setTimeout(() => setZoomOut(true), 1800)
    return () => clearTimeout(timer)
  }, [])

  // Generate horizontal speed lines for the pan effect
  const speedLines = useMemo(() => {
    return Array.from({ length: 18 }, (_, i) => ({
      id: i,
      top: `${(i / 18) * 100 + (seededFraction(i * 5 + 101) - 0.5) * 10}%`,
      delay: seededFraction(i * 5 + 102) * 0.6,
      duration: 0.3 + seededFraction(i * 5 + 103) * 0.3,
      width: 80 + seededFraction(i * 5 + 104) * 150,
      opacity: 0.2 + seededFraction(i * 5 + 105) * 0.3,
    }))
  }, [])

  // Calculate heatmap scale and container height to fit max height of 80px
  // Each cell is aspect-square, so cell height = cell width
  // Total width is container width (390 - 24 padding = 366), divided by weeks + gaps
  // Cell width ≈ 366 / weeks.length, Cell height = 7 cells * cellWidth + 6 gaps
  const { heatmapScale, heatmapHeight } = useMemo(() => {
    const MAX_HEIGHT = 150
    const containerWidth = 390 - 24 // canonical width minus padding
    const numWeeks = weeks.length || 1
    const cellWidth = containerWidth / numWeeks
    const naturalHeight = 7 * cellWidth // 7 days per week
    const scale = Math.min(1, MAX_HEIGHT / naturalHeight)
    const height = Math.min(MAX_HEIGHT, naturalHeight)
    return { heatmapScale: scale, heatmapHeight: height }
  }, [weeks.length])

  // Animation values calibrated for canonical size (390x844)
  const SCALE = 2.5
  // Pan positions scaled for the smaller viewport
  const START_X = 600 // Start position (first day visible on right side)
  const END_X = -350 // End position

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-8 overflow-hidden bg-[#0a0a0a] p-4 text-center text-white">
      {/* Animated gradient background */}
      <motion.div
        className="absolute inset-0 bg-gradient-to-br from-blue-900/30 via-[#0a0a0a] to-indigo-900/30"
        animate={{
          opacity: [0.5, 0.7, 0.5],
        }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Background Gradients - enhanced glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-[20%] -right-[20%] h-[350px] w-[350px] rounded-full bg-[#3e61d2]/15 blur-[100px]"
          animate={
            zoomOut ? { scale: 1.3, opacity: 0.2 } : { scale: 1, opacity: 0.15 }
          }
          transition={{ duration: 0.8 }}
        />
        <motion.div
          className="absolute -bottom-[20%] -left-[20%] h-[300px] w-[300px] rounded-full bg-[#5e81f2]/10 blur-[80px]"
          animate={
            zoomOut ? { scale: 1.2, opacity: 0.15 } : { scale: 1, opacity: 0.1 }
          }
          transition={{ duration: 0.8 }}
        />
      </div>

      {/* Horizontal speed lines during pan phase */}
      <AnimatePresence>
        {!zoomOut &&
          speedLines.map((line) => (
            <motion.div
              key={line.id}
              className="absolute z-0 h-[1.5px] rounded-full bg-gradient-to-r from-transparent via-blue-400/50 to-transparent"
              style={{
                top: line.top,
                width: line.width,
              }}
              initial={{ x: "100vw", opacity: 0 }}
              animate={{
                x: ["-10%", "-120%"],
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
        className="relative z-10 w-full"
      >
        <div className="flex items-center justify-center gap-3">
          {userAvatar ? (
            <Image
              unoptimized
              src={userAvatar}
              alt={userName || ""}
              width={40}
              height={40}
              className="h-10 w-10 rounded-full object-cover"
              style={{ boxShadow: "inset 0 0 0 2px rgba(255, 255, 255, 0.2)" }}
            />
          ) : (
            <div
              className="h-10 w-10 overflow-hidden rounded-full"
              style={{ boxShadow: "inset 0 0 0 2px rgba(255, 255, 255, 0.2)" }}
            >
              <div className="h-full w-full bg-gradient-to-br from-[#3e61d2] to-blue-500" />
            </div>
          )}
          <div className="text-left">
            {userName && <div className="text-base font-bold">{userName}</div>}
            <div className="text-xs text-blue-300/60">
              {t("{year} Year in Grades", { year })}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Heatmap container with camera animation */}
      <motion.div
        initial={{ scale: SCALE, x: START_X }}
        animate={zoomOut ? { scale: 1, x: 0 } : { scale: SCALE, x: END_X }}
        transition={
          zoomOut
            ? { duration: 0.5, type: "spring", bounce: 0.08 }
            : { duration: 1.8, ease: [0.35, 0.85, 0.35, 1] } // Snappier ease-out
        }
        className="relative z-10 w-full overflow-hidden rounded-xl bg-[#0d1117] p-3"
        style={{
          boxShadow:
            "inset 0 0 0 1px rgba(62, 97, 210, 0.2), 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(62, 97, 210, 0.1)",
        }}
      >
        {/* Subtle scan line effect during pan */}
        {!zoomOut && (
          <motion.div
            className="pointer-events-none absolute inset-y-0 z-10 w-16 bg-gradient-to-r from-transparent via-blue-400/10 to-transparent"
            initial={{ x: "-100%" }}
            animate={{ x: "500%" }}
            transition={{ duration: 2.5, ease: "easeOut" }}
          />
        )}

        <div
          className="flex w-full justify-center overflow-hidden"
          style={{ height: heatmapHeight }}
        >
          <div
            className="flex w-full gap-[1px]"
            style={{
              transform: `scale(${heatmapScale})`,
              transformOrigin: "top center",
            }}
          >
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-1 flex-col gap-[1px]">
                {week.map((day, dayIndex) => (
                  <div
                    key={`${weekIndex}-${dayIndex}`}
                    className={cn(
                      "aspect-square w-full rounded-[1px]",
                      !day
                        ? "bg-transparent"
                        : day.count === 0
                          ? "bg-[#161b22]"
                          : day.count === 1
                            ? "bg-[#1d2d60]"
                            : day.count <= 3
                              ? "bg-[#2d4696]"
                              : "bg-[#3e61d2]"
                    )}
                    style={
                      day && day.count === 0
                        ? {
                            boxShadow:
                              "inset 0 0 0 1px rgba(255, 255, 255, 0.03)",
                          }
                        : day && day.count > 3
                          ? { boxShadow: "0 0 4px rgba(62, 97, 210, 0.4)" }
                          : undefined
                    }
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
          className="mt-3 w-full text-left text-xs text-[#8b949e]"
        >
          {t("{count} grades in {year}", {
            count: String(stats.gradesCount),
            year,
          })}
        </motion.div>
      </motion.div>

      {/* Most Active Month - appears after zoom out */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={zoomOut ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="relative z-10 w-full"
      >
        <h3 className="mb-2 text-base text-[#8b949e]">
          {t("Most Active Month")}
        </h3>
        <div className="bg-gradient-to-r from-[#3e61d2] via-[#5e81f2] to-[#3e61d2] bg-clip-text text-4xl font-black tracking-wider text-transparent uppercase drop-shadow-[0_0_20px_rgba(62,97,210,0.4)]">
          {formattedMostActiveMonth}
        </div>
        <p className="mt-2 text-sm text-[#8b949e]">
          {t("{count} grades entered", {
            count: String(stats.mostActiveMonth.count),
          })}
        </p>
      </motion.div>
    </div>
  )
}

function StreakSlide({ stats, paused }: SlideProps) {
  const t = useExtracted()
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-black p-6 text-center text-white">
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
        paused={paused}
      />

      {/* Dark vignette overlay for better text contrast */}
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black/70 via-transparent to-black/50" />

      {/* Transforms only, no opacity fades: every opacity tween above the
          screen-blended WebGL canvas forced the compositor to re-blend the
          whole slide per frame, on top of the ray march. */}
      <div className="relative z-10">
        <motion.div
          initial={{ y: -20 }}
          animate={{ y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-8 inline-flex items-center gap-2 rounded-full bg-orange-500/20 px-4 py-2 text-orange-300 backdrop-blur-sm"
          style={{ boxShadow: "inset 0 0 0 1px rgba(249, 115, 22, 0.4)" }}
        >
          <div className="text-lg">🔥</div>
          <span className="text-sm font-bold tracking-wider uppercase">
            {t("On Fire!")}
          </span>
        </motion.div>

        <motion.h2
          initial={{ y: 20 }}
          animate={{ y: 0 }}
          transition={{ delay: 0.3 }}
          className="mb-4 text-3xl font-bold drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]"
        >
          {t("Longest Streak")}
        </motion.h2>

        <motion.div
          initial={{ scale: 0.5 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, delay: 0.4 }}
          className="bg-gradient-to-b from-yellow-300 via-orange-500 to-red-600 bg-clip-text text-[12rem] leading-none font-black text-transparent drop-shadow-[0_0_50px_rgba(234,88,12,0.5)]"
        >
          <CountUp
            value={stats.longestStreak}
            duration={1.5}
            delay={0.5}
            ease="circOut"
          />
        </motion.div>

        <motion.p
          initial={{ y: 20 }}
          animate={{ y: 0 }}
          transition={{ delay: 0.8 }}
          className="mx-auto mt-8 max-w-xs text-xl opacity-80 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
        >
          {t("Consecutive grades that increased your average")}
        </motion.p>
      </div>
    </div>
  )
}

function PrimeTimeSlide({ stats }: SlideProps) {
  const t = useExtracted()
  const [phase, setPhase] = useState<"tracing" | "peak" | "reveal">("tracing")
  const [progress, setProgress] = useState(0)
  const formatter = useFormatter()
  const date = formatter.dateTime(new Date(stats.primeTime.date), {
    day: "numeric",
    month: "long",
  })

  // Keep the original chart/camera choreography, but feed it the user's
  // actual running average instead of the old illustrative series.
  const chartData = useMemo(() => {
    const source =
      stats.averageSeries.length > 1
        ? stats.averageSeries
        : [
            { date: stats.primeTime.date, value: stats.primeTime.value },
            { date: stats.primeTime.date, value: stats.primeTime.value },
          ]
    const values = source.map((point) => point.value)
    const minimum = Math.min(...values)
    const maximum = Math.max(...values)
    const padding = Math.max((maximum - minimum) * 0.16, 0.25)
    const lower = Math.max(0, minimum - padding)
    const upper = Math.max(lower + 0.5, maximum + padding)
    const firstTime = source[0].date.getTime()
    const timeSpan = source[source.length - 1].date.getTime() - firstTime
    const points = source.map((point, index) => ({
      x:
        timeSpan > 0
          ? ((point.date.getTime() - firstTime) / timeSpan) * 100
          : (index / (source.length - 1)) * 100,
      y: 8 + ((point.value - lower) / (upper - lower)) * 84,
    }))
    let peakIndex = 0
    for (let index = 1; index < source.length; index += 1) {
      if (source[index].value > source[peakIndex].value) peakIndex = index
    }
    return { points, peakIndex }
  }, [stats.averageSeries, stats.primeTime.date, stats.primeTime.value])

  const { points, peakIndex } = chartData
  const peakPoint = points[peakIndex]
  const curve = useMemo(
    () =>
      buildYearReviewPath(
        points.map((point) => ({ x: point.x, y: 100 - point.y }))
      ),
    [points]
  )
  const pathD = curve.path
  const peakProgress = curve.progressAtPoint(peakIndex)

  // Animate progress for tracing phase
  useEffect(() => {
    if (phase !== "tracing") return

    const duration = 2500
    const startTime = performance.now()

    let frame = 0
    const animateProgress = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const t = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setProgress(eased * peakProgress)

      if (t < 1) {
        frame = requestAnimationFrame(animateProgress)
      }
    }

    frame = requestAnimationFrame(animateProgress)
    return () => cancelAnimationFrame(frame)
  }, [phase, peakProgress])

  // Animation timeline
  useEffect(() => {
    const peakTimer = setTimeout(() => setPhase("peak"), 2500)
    const revealTimer = setTimeout(() => setPhase("reveal"), 3200)

    return () => {
      clearTimeout(peakTimer)
      clearTimeout(revealTimer)
    }
  }, [])

  // Calculate current dot position
  const currentProgress = phase === "tracing" ? progress : peakProgress
  const currentDotPos = curve.pointAtProgress(currentProgress)

  // Camera follows dot during tracing - calculate offset to keep dot centered
  const cameraX = phase === "reveal" ? 0 : -(currentDotPos.x - 50) * 7
  const cameraY = phase === "reveal" ? 0 : -(currentDotPos.y - 50) * 2

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[#0a0a0a] text-center text-white">
      {/* Animated background gradient */}
      <motion.div
        className="absolute inset-0 bg-gradient-to-br from-emerald-900/20 via-[#0a0a0a] to-green-900/20"
        animate={phase === "reveal" ? { opacity: 0.8 } : { opacity: 0.4 }}
        transition={{ duration: 0.8 }}
      />

      {/* Background glow that intensifies at peak */}
      <motion.div
        className="absolute top-1/3 left-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/20 blur-[100px]"
        animate={
          phase === "peak"
            ? { scale: 1.5, opacity: 0.6 }
            : phase === "reveal"
              ? { scale: 2, opacity: 0.3, y: -50 }
              : { scale: 1, opacity: 0.1 }
        }
        transition={{ duration: 0.5 }}
      />

      {/* Chart container - camera follows dot, then zooms out */}
      <motion.div
        className="relative flex w-full flex-1 items-center justify-center"
        animate={{
          scale: phase === "reveal" ? 1 : 2.8,
          x: cameraX,
          y: phase === "reveal" ? 0 : cameraY + 80,
        }}
        transition={
          phase === "reveal"
            ? {
                duration: 0.7,
                type: "spring",
                bounce: 0.12,
              }
            : {
                duration: 0.1,
                ease: "linear",
              }
        }
      >
        <div className="relative h-[200px] w-full">
          {/* Grid lines */}
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {[20, 40, 60, 80].map((y) => (
              <motion.line
                key={y}
                x1="0"
                y1={y}
                x2="100"
                y2={y}
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="0.3"
                initial={{ opacity: 0 }}
                animate={{ opacity: phase === "reveal" ? 1 : 0.3 }}
              />
            ))}
          </svg>

          {/* Main chart SVG */}
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient
                id="chartGradientPrime"
                x1="0%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
              </linearGradient>
              <linearGradient
                id="lineGradientPrime"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="0%"
              >
                <stop offset="0%" stopColor="#16a34a" />
                <stop offset="100%" stopColor="#4ade80" />
              </linearGradient>
              <filter
                id="lineGlow"
                x="-50%"
                y="-50%"
                width="200%"
                height="200%"
              >
                <feGaussianBlur stdDeviation="1" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Hidden path for measuring */}
            <path d={pathD} fill="none" stroke="transparent" />

            {/* Area fill under line */}
            <motion.path
              d={`${pathD} L 100 100 L 0 100 Z`}
              fill="url(#chartGradientPrime)"
              initial={{ opacity: 0 }}
              animate={{ opacity: phase !== "tracing" ? 0.5 : 0.2 }}
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
                pathLength:
                  phase === "tracing"
                    ? progress
                    : phase === "peak"
                      ? peakProgress
                      : 1,
                opacity: 1,
              }}
              transition={{
                pathLength: {
                  duration: phase === "reveal" ? 0.3 : 0,
                  ease: "linear",
                },
                opacity: { duration: 0.1, delay: 0.05 },
              }}
            />
          </svg>

          {/* Glowing dot - positioned via DOM for proper following */}
          <motion.div
            className="pointer-events-none absolute z-10 -mt-1.5 -ml-1.5 h-3 w-3"
            style={{
              left: `${currentDotPos.x}%`,
              top: `${currentDotPos.y}%`,
            }}
          >
            <div
              className="h-full w-full rounded-full bg-emerald-400"
              style={{ boxShadow: "0 0 12px 4px rgba(74, 222, 128, 0.6)" }}
            />
          </motion.div>

          {/* Radar-style pulse rings - at dot position, infinite during reveal */}
          {(phase === "peak" || phase === "reveal") && (
            <div
              className="pointer-events-none absolute z-0 -mt-[36px] -ml-[36px] h-[72px] w-[72px]"
              style={{
                left: `${peakPoint.x}%`,
                top: `${100 - peakPoint.y}%`,
                contain: "layout style",
                isolation: "isolate",
                transform: "translate3d(0, 0, 0)",
              }}
            >
              <div className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2">
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-emerald-400/80"
                  style={{
                    opacity: 0,
                    willChange: "transform, opacity",
                    backfaceVisibility: "hidden",
                    transformOrigin: "50% 50%",
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
                    willChange: "transform, opacity",
                    backfaceVisibility: "hidden",
                    transformOrigin: "50% 50%",
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
            </div>
          )}

          {/* Peak marker */}
          <motion.div
            className="pointer-events-none absolute"
            style={{
              left: `${peakPoint.x}%`,
              top: `${100 - peakPoint.y}%`,
            }}
            initial={{ opacity: 0, scale: 0, y: 0 }}
            animate={
              phase === "reveal"
                ? { opacity: 1, scale: 1, y: -50 }
                : { opacity: 0, scale: 0, y: 0 }
            }
            transition={{ delay: 0.3, type: "spring", bounce: 0.4 }}
          >
            <div
              className="-translate-x-1/2 rounded-md bg-emerald-500 px-2 py-1 text-[10px] font-bold whitespace-nowrap text-white"
              style={{ boxShadow: "0 0 20px rgba(34, 197, 94, 0.5)" }}
            >
              {t("PEAK")}
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Stats reveal section */}
      <motion.div
        className="relative z-10 w-full px-4 pb-4"
        initial={{ opacity: 0, y: 40 }}
        animate={
          phase === "reveal" ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }
        }
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        <h2 className="mb-2 text-lg font-medium text-emerald-400/80">
          {t("Prime Time")}
        </h2>

        <div className="mb-3 flex items-baseline justify-center gap-1">
          <span className="bg-gradient-to-r from-emerald-400 to-green-300 bg-clip-text text-6xl font-black text-transparent drop-shadow-[0_0_30px_rgba(34,197,94,0.5)]">
            {stats.primeTime.value.toFixed(2)}
          </span>
          <span className="text-xl text-emerald-400/60">/20</span>
        </div>

        <p className="text-sm text-zinc-400">
          {t.rich("Peak reached on <date></date>", {
            date: () => (
              <span className="font-semibold text-emerald-400">{date}</span>
            ),
          })}
        </p>
      </motion.div>
    </div>
  )
}

function SubjectsSlide({ stats }: SlideProps) {
  const t = useExtracted()
  const [phase, setPhase] = useState<
    "anticipation" | "reveal3" | "reveal2" | "reveal1" | "complete"
  >("anticipation")

  // Animation timeline: staggered reveal from #3 to #1
  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase("reveal3"), 400),
      setTimeout(() => setPhase("reveal2"), 1000),
      setTimeout(() => setPhase("reveal1"), 1600),
      setTimeout(() => setPhase("complete"), 2400),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  const subjects = stats.bestSubjects.slice(0, 3)
  const hasProgression = stats.bestProgression.value > 0

  // Podium heights for visual hierarchy
  const podiumHeights = [140, 180, 110] // #2, #1, #3

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[#0a0a0a] text-center text-white">
      {/* Animated background */}
      <motion.div
        className="absolute inset-0 bg-gradient-to-br from-amber-900/20 via-[#0a0a0a] to-orange-900/20"
        animate={{ opacity: [0.4, 0.6, 0.4] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Spotlight effect on #1 position */}
      <motion.div
        className="absolute top-0 left-1/2 h-[500px] w-[300px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at top, rgba(251, 191, 36, 0.12) 0%, transparent 60%)",
        }}
        initial={{ opacity: 0, scaleY: 0 }}
        animate={
          phase === "reveal1" || phase === "complete"
            ? { opacity: 1, scaleY: 1 }
            : { opacity: 0, scaleY: 0 }
        }
        transition={{ duration: 0.8, ease: "easeOut" }}
      />

      {/* Title */}
      <motion.div
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5 }}
        className="relative z-10 mb-6"
      >
        <h2 className="bg-gradient-to-r from-amber-400 to-orange-300 bg-clip-text text-2xl font-bold text-transparent">
          {t("Top Subjects")}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          {t("Your academic podium")}
        </p>
      </motion.div>

      {/* Podium container */}
      <div
        className="relative z-10 flex w-full max-w-[360px] items-end justify-center gap-2 px-4"
        style={{ height: "320px" }}
      >
        {/* #2 - Left podium */}
        {subjects[1] ? (
          <div className="flex flex-col items-center" style={{ width: "30%" }}>
            <AnimatePresence>
              {(phase === "reveal2" ||
                phase === "reveal1" ||
                phase === "complete") &&
                subjects[1] && (
                  <motion.div
                    initial={{ opacity: 0, y: 30, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: "spring", bounce: 0.4, duration: 0.8 }}
                    className="mb-2 w-full text-center"
                  >
                    <div className="mb-1 text-3xl font-black text-zinc-400">
                      2
                    </div>
                    <div className="w-full truncate px-1 text-xs font-semibold text-zinc-400">
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
              animate={{
                height:
                  phase !== "anticipation" && phase !== "reveal3"
                    ? podiumHeights[0]
                    : 0,
              }}
              transition={{ type: "spring", bounce: 0.3, duration: 0.8 }}
              style={{
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.15), 0 0 20px rgba(161, 161, 170, 0.1)",
              }}
            />
          </div>
        ) : null}

        {/* #1 - Center podium (tallest) */}
        <div className="flex flex-col items-center" style={{ width: "36%" }}>
          <AnimatePresence>
            {(phase === "reveal1" || phase === "complete") && subjects[0] && (
              <motion.div
                initial={{ opacity: 0, y: 30, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", bounce: 0.4, duration: 0.8 }}
                className="mb-2 w-full text-center"
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
                <div
                  className="text-4xl font-black text-amber-400"
                  style={{ textShadow: "0 0 20px rgba(251, 191, 36, 0.5)" }}
                >
                  1
                </div>
                <div className="w-full truncate px-1 text-sm font-bold text-white">
                  {subjects[0].name}
                </div>
                <motion.div
                  className="text-lg font-black text-amber-400"
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.4, type: "spring" }}
                  style={{ textShadow: "0 0 15px rgba(251, 191, 36, 0.4)" }}
                >
                  {subjects[0].value.toFixed(2)}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          <motion.div
            className="w-full rounded-t-lg bg-gradient-to-t from-amber-600 to-amber-500"
            initial={{ height: 0 }}
            animate={{
              height:
                phase === "reveal1" || phase === "complete"
                  ? podiumHeights[1]
                  : 0,
            }}
            transition={{ type: "spring", bounce: 0.3, duration: 0.8 }}
            style={{
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.25), 0 0 40px rgba(251, 191, 36, 0.3)",
            }}
          />
        </div>

        {/* #3 - Right podium */}
        {subjects[2] ? (
          <div className="flex flex-col items-center" style={{ width: "30%" }}>
            <AnimatePresence>
              {phase !== "anticipation" && subjects[2] && (
                <motion.div
                  initial={{ opacity: 0, y: 30, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", bounce: 0.4, duration: 0.8 }}
                  className="mb-2 w-full text-center"
                >
                  <div className="mb-1 text-2xl font-black text-orange-400">
                    3
                  </div>
                  <div className="w-full truncate px-1 text-xs font-semibold text-zinc-400">
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
              animate={{
                height: phase !== "anticipation" ? podiumHeights[2] : 0,
              }}
              transition={{ type: "spring", bounce: 0.3, duration: 0.8 }}
              style={{
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.1), 0 0 20px rgba(234, 88, 12, 0.15)",
              }}
            />
          </div>
        ) : null}
      </div>

      {/* Best Progression - appears last */}
      {hasProgression && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={
            phase === "complete"
              ? { opacity: 1, y: 0, scale: 1 }
              : { opacity: 0, y: 20, scale: 0.95 }
          }
          transition={{ delay: 0.3, duration: 0.5, ease: "easeOut" }}
          className="relative z-10 mt-8 flex items-center gap-3 px-4"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600">
            <TrendingUp className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="mb-0.5 text-xs text-zinc-500">
              {t("Best Comeback")}
            </div>
            <div className="truncate font-semibold text-white">
              {stats.bestProgression.subject}
            </div>
          </div>
          <div className="shrink-0 text-lg font-bold text-emerald-400">
            +{stats.bestProgression.value.toFixed(2)}
          </div>
        </motion.div>
      )}
    </div>
  )
}

function PercentileSlide({ stats }: SlideProps) {
  const t = useExtracted()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const confettiInstanceRef = useRef<ReturnType<typeof confetti.create> | null>(
    null
  )
  const [phase, setPhase] = useState<"inspiral" | "explode" | "revealed">(
    "inspiral"
  )
  const [orb1Pos, setOrb1Pos] = useState({ x: 0, y: 0 })
  const [orb2Pos, setOrb2Pos] = useState({ x: 0, y: 0 })
  const [orbRadius, setOrbRadius] = useState(80)
  const animationRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)

  // Neutron star inspiral animation - accelerating spiral inward
  useEffect(() => {
    if (phase !== "inspiral") return

    const TOTAL_DURATION = 1000 // Total inspiral time (1 second)
    const INITIAL_RADIUS = 90
    const FINAL_RADIUS = 5
    const INITIAL_SPEED = 4 // rotations per second at start
    const FINAL_SPEED = 18 // rotations per second at end

    const animateInspiral = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp
      const elapsed = timestamp - startTimeRef.current
      const progress = Math.min(elapsed / TOTAL_DURATION, 1)

      // Exponential decay for radius - gets tighter faster near the end
      const radiusProgress = Math.pow(progress, 1.5)
      const currentRadius =
        INITIAL_RADIUS - (INITIAL_RADIUS - FINAL_RADIUS) * radiusProgress
      setOrbRadius(currentRadius)

      // Calculate angle - integral of speed over time for smooth acceleration
      const baseRotations = INITIAL_SPEED * (elapsed / 1000)
      const acceleratedRotations =
        ((FINAL_SPEED - INITIAL_SPEED) *
          Math.pow(progress, 3) *
          (elapsed / 1000)) /
        3
      const angle = (baseRotations + acceleratedRotations) * Math.PI * 2

      // Orb 1 position (180 degrees offset from orb 2)
      setOrb1Pos({
        x: Math.cos(angle) * currentRadius,
        y: Math.sin(angle) * currentRadius,
      })

      // Orb 2 position (opposite side)
      setOrb2Pos({
        x: Math.cos(angle + Math.PI) * currentRadius,
        y: Math.sin(angle + Math.PI) * currentRadius,
      })

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animateInspiral)
      }
    }

    animationRef.current = requestAnimationFrame(animateInspiral)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [phase])

  // Phase timeline
  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase("explode"), 1000),
      setTimeout(() => setPhase("revealed"), 1300),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  // Create confetti instance
  useEffect(() => {
    if (canvasRef.current && !confettiInstanceRef.current) {
      confettiInstanceRef.current = confetti.create(canvasRef.current, {
        resize: false,
        useWorker: true,
      })
    }
    return () => {
      if (confettiInstanceRef.current) {
        confettiInstanceRef.current.reset()
      }
    }
  }, [])

  // Fire confetti on explosion - kilonova style burst
  useEffect(() => {
    if (phase === "explode" && confettiInstanceRef.current) {
      // Main kilonova explosion - bright burst
      confettiInstanceRef.current({
        particleCount: 120,
        spread: 360,
        origin: { x: 0.5, y: 0.45 },
        colors: [
          "#fbbf24",
          "#f59e0b",
          "#ffffff",
          "#a855f7",
          "#6366f1",
          "#ec4899",
          "#22d3ee",
        ],
        startVelocity: 50,
        gravity: 0.8,
        scalar: 1.2,
      })
      // Secondary ring burst
      setTimeout(() => {
        confettiInstanceRef.current?.({
          particleCount: 80,
          spread: 360,
          origin: { x: 0.5, y: 0.45 },
          colors: ["#fbbf24", "#ffffff", "#f97316"],
          startVelocity: 35,
          gravity: 0.6,
        })
      }, 80)
      // Final sparkle
      setTimeout(() => {
        confettiInstanceRef.current?.({
          particleCount: 40,
          spread: 180,
          origin: { x: 0.5, y: 0.45 },
          colors: ["#ffffff", "#fef3c7"],
          startVelocity: 25,
        })
      }, 200)
    }
  }, [phase])

  // Orb scale shrinks as they spiral in
  const orbScale = Math.max(0.4, orbRadius / 90)

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[#0a0a0a] p-4 text-center text-white">
      {/* Confetti canvas */}
      <canvas
        ref={canvasRef}
        width={CANONICAL_WIDTH}
        height={CANONICAL_HEIGHT}
        className="pointer-events-none absolute inset-0 z-30"
        style={{ width: "100%", height: "100%" }}
      />

      {/* Dark ambient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-950/30 via-[#0a0a0a] to-indigo-950/30" />

      {/* Gravitational wave ripples during inspiral */}
      {phase === "inspiral" && (
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
            transition={{
              duration: 0.4,
              repeat: Infinity,
              ease: "linear",
              delay: 0.1,
            }}
          />
        </>
      )}

      {/* Orb container - centered */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ top: "-10%" }}
      >
        {/* Orb 1 - Purple/Pink */}
        {phase === "inspiral" && (
          <motion.div
            className="absolute rounded-full"
            style={{
              width: 100 * orbScale,
              height: 100 * orbScale,
              background:
                "radial-gradient(circle at 30% 30%, rgba(168, 85, 247, 0.9), rgba(236, 72, 153, 0.7), transparent 70%)",
              filter: `blur(${12 * orbScale}px)`,
              x: orb1Pos.x,
              y: orb1Pos.y,
            }}
          />
        )}

        {/* Orb 2 - Blue/Cyan */}
        {phase === "inspiral" && (
          <motion.div
            className="absolute rounded-full"
            style={{
              width: 100 * orbScale,
              height: 100 * orbScale,
              background:
                "radial-gradient(circle at 30% 30%, rgba(99, 102, 241, 0.9), rgba(34, 211, 238, 0.7), transparent 70%)",
              filter: `blur(${12 * orbScale}px)`,
              x: orb2Pos.x,
              y: orb2Pos.y,
            }}
          />
        )}

        {/* Trail effect - fading afterimages */}
        {phase === "inspiral" && orbRadius > 20 && (
          <>
            <div
              className="absolute rounded-full opacity-30"
              style={{
                width: 80 * orbScale,
                height: 80 * orbScale,
                background:
                  "radial-gradient(circle, rgba(168, 85, 247, 0.5), transparent 70%)",
                filter: `blur(${15 * orbScale}px)`,
                transform: `translate(${orb1Pos.x * 0.85}px, ${orb1Pos.y * 0.85}px)`,
              }}
            />
            <div
              className="absolute rounded-full opacity-30"
              style={{
                width: 80 * orbScale,
                height: 80 * orbScale,
                background:
                  "radial-gradient(circle, rgba(99, 102, 241, 0.5), transparent 70%)",
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
            background:
              "radial-gradient(circle, rgba(255, 255, 255, 1) 0%, rgba(251, 191, 36, 0.8) 20%, rgba(249, 115, 22, 0.5) 40%, transparent 70%)",
          }}
          initial={{ scale: 0, opacity: 0 }}
          animate={
            phase === "explode" || phase === "revealed"
              ? {
                  scale: [0, 2.5, 0],
                  opacity: [0, 1, 0],
                }
              : { scale: 0, opacity: 0 }
          }
          transition={{ duration: 0.5, ease: "easeOut" }}
        />

        {/* Secondary shockwave ring */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 100,
            height: 100,
            border: "3px solid rgba(251, 191, 36, 0.8)",
            background: "transparent",
          }}
          initial={{ scale: 0, opacity: 0 }}
          animate={
            phase === "explode" || phase === "revealed"
              ? {
                  scale: [0, 5],
                  opacity: [1, 0],
                }
              : { scale: 0, opacity: 0 }
          }
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
        />
      </div>

      {/* Content - revealed after explosion */}
      <div className="relative z-20">
        <motion.div
          initial={{ opacity: 0, scale: 0 }}
          animate={
            phase === "revealed"
              ? { opacity: 1, scale: 1 }
              : { opacity: 0, scale: 0 }
          }
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="mb-4 inline-flex items-center gap-2 rounded-full bg-yellow-500/20 px-3 py-1.5 text-yellow-300"
          style={{ boxShadow: "inset 0 0 0 1px rgba(234, 179, 8, 0.4)" }}
        >
          <Trophy className="h-3 w-3" />
          <span className="text-xs font-bold tracking-wider uppercase">
            {t("Legendary Status")}
          </span>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={
            phase === "revealed" ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }
          }
          transition={{ delay: 0.1 }}
          className="mb-2 text-2xl font-bold"
        >
          {t("You are in the top")}
        </motion.h2>

        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={
            phase === "revealed"
              ? { scale: 1, opacity: 1 }
              : { scale: 0, opacity: 0 }
          }
          transition={{
            type: "spring",
            stiffness: 200,
            damping: 15,
            delay: 0.15,
          }}
          className="bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-700 bg-clip-text text-[8rem] leading-none font-black text-transparent"
          style={{ textShadow: "0 0 60px rgba(251, 191, 36, 0.5)" }}
        >
          {stats.topPercentile}%
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={
            phase === "revealed" ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }
          }
          transition={{ delay: 0.3 }}
          className="mx-auto mt-4 max-w-[280px] text-base text-zinc-400"
        >
          {t("of the most active students this year!")}
        </motion.p>
      </div>

      {/* Ambient glow after reveal */}
      <motion.div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 40%, rgba(251, 191, 36, 0.15) 0%, transparent 50%)",
        }}
        initial={{ opacity: 0 }}
        animate={phase === "revealed" ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.5 }}
      />
    </div>
  )
}

// Stats Card Component - sized for canonical 390x844 viewport
// Using box-shadow instead of border for consistent rendering at different scales
function StatCard({
  icon: Icon,
  title,
  value,
  colorClass,
  truncate = false,
  className,
  ...props
}: {
  icon: LucideIcon
  title: string
  value: string | number
  colorClass: string
  truncate?: boolean
  className?: string
} & React.ComponentProps<typeof motion.div>) {
  return (
    <motion.div
      className={cn(
        "flex h-full flex-col items-start rounded-lg bg-[#161b22] p-2.5",
        className
      )}
      style={{
        boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1)",
      }}
      {...props}
    >
      <div className="mb-0.5 flex items-center gap-1.5">
        <Icon className={cn("h-3 w-3", colorClass)} />
        <span className="text-[10px] font-medium text-gray-400">{title}</span>
      </div>
      <div
        className={cn(
          "my-auto text-left text-2xl leading-[0.9] font-bold capitalize",
          colorClass,
          truncate && "line-clamp-2 w-full break-words"
        )}
      >
        {value}
      </div>
    </motion.div>
  )
}

const awardIcons: Record<string, LucideIcon> = {
  Scale: Scale,
  RefreshCcw: RefreshCcw,
  Dices: Dices,
  Crown: Crown,
  Shuffle: Shuffle,
  Crosshair: Crosshair,
  Gem: Gem,
  UserCheck: UserCheck,
  Plane: Plane,
}

type AwardStyle = Pick<AwardData, "icon" | "color" | "bg" | "gradient">

// Visual award data stays locale-independent. All displayed copy is extracted
// from literal English sources in useAward below.
const AWARD_STYLES: Record<AwardType, AwardStyle> = {
  tourist: {
    icon: "Plane",
    color: "text-pink-400",
    bg: "bg-pink-500/10 border-pink-500/20",
    gradient: "from-pink-400 to-rose-400",
  },
  tightrope: {
    icon: "Scale",
    color: "text-orange-400",
    bg: "bg-orange-500/10 border-orange-500/20",
    gradient: "from-orange-500 to-amber-500",
  },
  comeback: {
    icon: "RefreshCcw",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    gradient: "from-emerald-500 to-green-500",
  },
  allin: {
    icon: "Dices",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
    gradient: "from-red-500 to-rose-500",
  },
  masterclass: {
    icon: "Crown",
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/20",
    gradient: "from-yellow-400 to-amber-400",
  },
  unpredictable: {
    icon: "Shuffle",
    color: "text-purple-400",
    bg: "bg-purple-500/10 border-purple-500/20",
    gradient: "from-purple-500 to-violet-500",
  },
  precision: {
    icon: "Crosshair",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    gradient: "from-blue-400 to-cyan-400",
  },
  legend: {
    icon: "Gem",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10 border-cyan-500/20",
    gradient: "from-cyan-400 to-sky-400",
  },
  avermatien: {
    icon: "UserCheck",
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/20",
    gradient: "from-green-400 to-emerald-400",
  },
}

function useAward(awardType: AwardType): AwardData {
  const t = useExtracted()
  const copy: Record<
    AwardType,
    Pick<AwardData, "title" | "description" | "condition">
  > = {
    tourist: {
      title: t("The Tourist"),
      description: t(
        "You saw the light, you came in, you added a few grades and you left. We don't know if it's absolute confidence or talent, but we love the audacity."
      ),
      condition: t("Less than 15 grades added"),
    },
    tightrope: {
      title: t("The Tightrope Walker"),
      description: t(
        "You walked on a wire all year, the void to the left, the void to the right... but you never fell. The art of balance, the real one."
      ),
      condition: t("Average between 10 and 11"),
    },
    comeback: {
      title: t("The Comeback King"),
      description: t(
        "The start of the season was complicated. We were scared. And then you shifted into second gear and overtook everyone before the finish line."
      ),
      condition: t("+2 pts vs beginning of year"),
    },
    allin: {
      title: t('The "All In"'),
      description: t(
        "Why try to be average everywhere when you can bet everything on your strengths? A risky strategy, but it pays off."
      ),
      condition: t("+5 pts gap between subjects"),
    },
    masterclass: {
      title: t("The Masterclass"),
      description: t(
        "Congratulations. You crushed the school year with disconcerting ease."
      ),
      condition: t("Overall average > 15"),
    },
    unpredictable: {
      title: t("The Unpredictable"),
      description: t(
        "Capable of absolute genius as well as total failure within the same subject. With you, it's all or nothing."
      ),
      condition: t("Highly variable grades"),
    },
    precision: {
      title: t("The Precision"),
      description: t(
        "Surgical regularity. When you aim for a grade, you hit it every time. No bad surprises, you're a safe bet."
      ),
      condition: t("Very consistent grades"),
    },
    legend: {
      title: t("Avermate Legend"),
      description: t(
        "Your tracking is so complete that you know your average better than your teachers. You are one with the app."
      ),
      condition: t("More than 40 grades"),
    },
    avermatien: {
      title: t("Avermatian"),
      description: t(
        "Certified Avermate user. Not too much, not too little. You manage your year with the seriousness of an accountant. It's solid."
      ),
      condition: t("More than 15 grades"),
    },
  }
  const style = AWARD_STYLES[awardType] || AWARD_STYLES.tourist
  return { ...style, ...copy[awardType] }
}

function AwardIntroSlide() {
  const t = useExtracted()
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-black p-6 text-center text-white">
      {/* Shiny Gold Background */}
      <div className="absolute inset-0 bg-gradient-to-tr from-yellow-400/50 via-black to-yellow-400/50" />

      <div className="relative z-10 max-w-md space-y-8">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="text-2xl font-light text-gray-400"
        >
          {t("We've analyzed your performance...")}
        </motion.p>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5 }}
          className="text-3xl font-medium"
        >
          {t("And found the perfect title for you.")}
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
  )
}

// Helper to get confetti colors based on award color
const getAwardConfettiColors = (colorClass: string): string[] => {
  if (colorClass.includes("yellow")) return ["#fbbf24", "#f59e0b", "#ffffff"]
  if (colorClass.includes("red")) return ["#ef4444", "#dc2626", "#ffffff"]
  if (colorClass.includes("orange")) return ["#f97316", "#ea580c", "#ffffff"]
  if (colorClass.includes("green")) return ["#22c55e", "#16a34a", "#ffffff"]
  if (colorClass.includes("purple")) return ["#a855f7", "#9333ea", "#ffffff"]
  if (colorClass.includes("pink")) return ["#ec4899", "#db2777", "#ffffff"]
  if (colorClass.includes("cyan")) return ["#06b6d4", "#0891b2", "#ffffff"]
  if (colorClass.includes("teal")) return ["#14b8a6", "#0d9488", "#ffffff"]
  return ["#3b82f6", "#2563eb", "#ffffff"] // blue default
}

// Helper to get box-shadow color based on award color
const getAwardBorderColor = (colorClass: string): string => {
  if (colorClass.includes("yellow")) return "rgba(234, 179, 8, 0.2)"
  if (colorClass.includes("red")) return "rgba(239, 68, 68, 0.2)"
  if (colorClass.includes("orange")) return "rgba(249, 115, 22, 0.2)"
  if (colorClass.includes("green")) return "rgba(34, 197, 94, 0.2)"
  if (colorClass.includes("purple")) return "rgba(168, 85, 247, 0.2)"
  if (colorClass.includes("pink")) return "rgba(236, 72, 153, 0.2)"
  if (colorClass.includes("cyan")) return "rgba(6, 182, 212, 0.2)"
  if (colorClass.includes("teal")) return "rgba(20, 184, 166, 0.2)"
  return "rgba(59, 130, 246, 0.2)" // blue default
}

function AwardRevealSlide({ stats }: SlideProps) {
  const t = useExtracted()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const confettiInstanceRef = useRef<ReturnType<typeof confetti.create> | null>(
    null
  )
  const award = useAward(stats.awardType)
  const Icon = awardIcons[award.icon] || Plane

  useEffect(() => {
    // Create a confetti instance bound to our canvas inside the story
    if (canvasRef.current && !confettiInstanceRef.current) {
      confettiInstanceRef.current = confetti.create(canvasRef.current, {
        resize: false,
        useWorker: true,
      })
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
        })
      }
    }, 600)

    return () => {
      clearTimeout(timer)
      if (confettiInstanceRef.current) {
        confettiInstanceRef.current.reset()
      }
    }
  }, [award.color])

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-black p-6 text-center text-white">
      {/* Confetti canvas - fixed to canonical dimensions */}
      <canvas
        ref={canvasRef}
        width={CANONICAL_WIDTH}
        height={CANONICAL_HEIGHT}
        className="pointer-events-none absolute inset-0 z-20"
        style={{ width: "100%", height: "100%" }}
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
        <div
          className="mb-2 rounded-full bg-yellow-500/20 p-3"
          style={{ boxShadow: "inset 0 0 0 1px rgba(234, 179, 8, 0.3)" }}
        >
          <Trophy className="h-6 w-6 text-yellow-400" />
        </div>
        <h2 className="text-2xl font-bold text-zinc-100">{t("Your Award")}</h2>
      </motion.div>

      <motion.div
        initial={{ scale: 0.5, opacity: 0, rotateY: 90 }}
        animate={{ scale: 1, opacity: 1, rotateY: 0 }}
        transition={{ duration: 0.8, type: "spring", bounce: 0.3 }}
        className={cn(
          "relative z-10 flex w-full max-w-sm items-center justify-between rounded-lg bg-[#161b22] p-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.5)]",
          award.bg.replace(/border-[a-z]+-[0-9]+\/[0-9]+/g, "")
        )}
        style={{
          boxShadow: `0 20px 50px rgba(0,0,0,0.5), inset 0 0 0 1px ${getAwardBorderColor(award.color)}`,
        }}
      >
        <div className="flex flex-col items-start text-left">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className={cn(
              "mb-1 text-xs font-bold tracking-wider uppercase",
              award.color
            )}
          >
            {award.title}
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="text-md leading-tight font-bold text-white sm:text-xl"
          >
            {award.condition}
          </motion.div>
        </div>
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.8, type: "spring" }}
        >
          <Icon className={cn("h-10 w-10", award.color)} />
        </motion.div>
      </motion.div>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.5 }}
        className="relative z-10 mt-8 max-w-xs text-sm text-zinc-100"
      >
        {award.description}
      </motion.p>
    </div>
  )
}

function OutroSlide({
  year,
  yearStartDate,
  yearEndDate,
  stats,
  onClose,
  userName,
  userAvatar,
}: SlideProps) {
  const t = useExtracted()
  const recapRef = useRef<HTMLDivElement>(null)
  const [isSharing, setIsSharing] = useState(false)
  const formatter = useFormatter()

  const award = useAward(stats.awardType)
  const Icon = awardIcons[award.icon] || Plane

  // Format the most active month using next-intl
  const formattedMostActiveMonth = useMemo(() => {
    const [yearNum, monthNum] = stats.mostActiveMonth.month
      .split("-")
      .map(Number)
    const date = new Date(yearNum, monthNum - 1, 1)
    return formatter.dateTime(date, { month: "long" })
  }, [stats.mostActiveMonth.month, formatter])

  const weeks = useMemo(() => {
    const now = new Date()

    // Use provided year dates or fall back to parsing year name
    let startDate: Date
    let endDate: Date

    if (yearStartDate && yearEndDate) {
      startDate = new Date(yearStartDate)
      endDate = new Date(
        Math.min(new Date(yearEndDate).getTime(), now.getTime())
      )
    } else {
      const yearNum = parseInt(year)
      const targetYear = isNaN(yearNum) ? now.getFullYear() : yearNum
      startDate = new Date(targetYear, 0, 1)
      const isCurrentYear = now.getFullYear() === targetYear
      endDate = isCurrentYear ? now : new Date(targetYear, 11, 31)
    }

    const currentDate = new Date(startDate)
    const days = []

    while (currentDate <= endDate) {
      const dateStr = localDayKey(currentDate)
      const count = stats.heatmap[dateStr] || 0
      days.push({
        date: new Date(currentDate),
        count,
        dateStr,
      })
      currentDate.setDate(currentDate.getDate() + 1)
    }

    const w: ((typeof days)[0] | null)[][] = []
    let currentWeek: ((typeof days)[0] | null)[] = Array(7).fill(null)

    // Pad beginning
    if (days.length > 0) {
      const firstDayOfWeek = days[0].date.getDay()
      for (let i = 0; i < firstDayOfWeek; i++) {
        currentWeek[i] = null
      }
    }

    days.forEach((day) => {
      const dayIndex = day.date.getDay()
      currentWeek[dayIndex] = day

      if (dayIndex === 6) {
        w.push(currentWeek)
        currentWeek = Array(7).fill(null)
      }
    })

    if (currentWeek.some((d) => d !== null)) {
      w.push(currentWeek)
    }

    return w
  }, [stats.heatmap, year, yearStartDate, yearEndDate])

  // Calculate heatmap scale and container height to fit max height of 40px for the mini heatmap
  const { heatmapScale, heatmapHeight } = useMemo(() => {
    const MAX_HEIGHT = 60
    const containerWidth = 390 - 48 // canonical width minus more padding for mini version
    const numWeeks = weeks.length || 1
    const cellWidth = containerWidth / numWeeks
    const naturalHeight = 7 * cellWidth // 7 days per week
    const scale = Math.min(1, MAX_HEIGHT / naturalHeight)
    const height = Math.min(MAX_HEIGHT, naturalHeight)
    return { heatmapScale: scale, heatmapHeight: height }
  }, [weeks.length])

  const handleShare = async () => {
    if (!recapRef.current || isSharing) return

    setIsSharing(true)

    try {
      // Wait a frame for the content to fully render
      await new Promise((resolve) => requestAnimationFrame(resolve))

      const dataUrl = await toPng(recapRef.current, {
        backgroundColor: "#0d1117",
        pixelRatio: 3, // High resolution for sharing
        cacheBust: true,
      })

      // Convert data URL to blob
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      const file = new File([blob], `avermate-recap-${year}.png`, {
        type: "image/png",
      })

      if (
        navigator.share &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({
            files: [file],
            title: t("My {year} Recap on Avermate", { year }),
            text: t(
              "I was in the top {percent}% of Avermate users in {year}!",
              { percent: String(stats.topPercentile), year }
            ),
          })
        } catch (err) {
          console.error("Error sharing:", err)
          downloadImage(dataUrl)
        }
      } else {
        downloadImage(dataUrl)
      }
      setIsSharing(false)
    } catch (err) {
      console.error("Error generating image:", err)
      setIsSharing(false)
    }
  }

  const downloadImage = (dataUrl: string) => {
    const link = document.createElement("a")
    link.download = `avermate-recap-${year}.png`
    link.href = dataUrl
    link.click()
  }

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.3,
      },
    },
  }

  const item = {
    hidden: { opacity: 0, scale: 0.9 },
    show: { opacity: 1, scale: 1 },
  }

  return (
    <div className="relative flex h-full flex-col items-center overflow-hidden bg-[#0d1117] p-3 text-center text-white">
      {/* Animated background gradients */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(circle at 50% 20%, rgba(99, 102, 241, 0.25) 0%, transparent 40%)",
        }}
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(circle at 0% 60%, rgba(168, 85, 247, 0.2) 0%, transparent 35%)",
        }}
        animate={{ opacity: [0.4, 0.8, 0.4] }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1,
        }}
      />
      <motion.div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(circle at 100% 85%, rgba(59, 130, 246, 0.2) 0%, transparent 35%)",
        }}
        animate={{ opacity: [0.5, 0.9, 0.5] }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 2,
        }}
      />

      {/* Recap content to be captured */}
      <div
        ref={recapRef}
        className="relative z-10 flex h-full w-full flex-col p-3"
      >
        {/* Header - sized for canonical viewport */}
        <div className="mb-3 flex w-full shrink-0 items-center gap-2">
          {userAvatar ? (
            <Image
              unoptimized
              src={userAvatar}
              alt={userName || ""}
              width={40}
              height={40}
              className="h-10 w-10 rounded-full object-cover"
              style={{ boxShadow: "inset 0 0 0 2px rgba(255, 255,255, 0.2)" }}
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-base font-bold">
              {year.slice(-2)}
            </div>
          )}
          <div className="text-left">
            {userName && <div className="text-base font-bold">{userName}</div>}
            <div className="text-[10px] text-[#8b949e]">
              {t("{year} Recap • Avermate", { year })}
            </div>
          </div>
        </div>

        {/* Grid Layout - Flex grow to fill space */}
        <motion.div
          className="flex flex-1 flex-col"
          variants={container}
          initial="hidden"
          animate="show"
        >
          {/* Mini Heatmap Visual (Real Data) - sized for canonical viewport */}
          <motion.div
            variants={item}
            className="mb-3 flex w-full shrink-0 flex-col items-center rounded-xl bg-[#161b22] p-3"
            style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1)" }}
          >
            <div
              className="flex w-full justify-center overflow-hidden"
              style={{ height: heatmapHeight }}
            >
              <div
                className="flex w-full gap-[1px]"
                style={{
                  transform: `scale(${heatmapScale})`,
                  transformOrigin: "top center",
                }}
              >
                {weeks.map((week, weekIndex) => (
                  <div
                    key={weekIndex}
                    className="flex flex-1 flex-col gap-[1px]"
                  >
                    {week.map((day, dayIndex) => (
                      <div
                        key={`${weekIndex}-${dayIndex}`}
                        className={cn(
                          "aspect-square w-full rounded-full",
                          !day
                            ? "bg-transparent"
                            : day.count === 0
                              ? "bg-[#161b22]"
                              : day.count === 1
                                ? "bg-[#1d2d60]"
                                : day.count <= 3
                                  ? "bg-[#2d4696]"
                                  : "bg-[#3e61d2]"
                        )}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-1.5 text-left text-[10px] text-[#8b949e]">
              {t("{count} grades in {year}", {
                count: String(stats.gradesCount),
                year,
              })}
            </div>
          </motion.div>

          <div className="mb-3 grid w-full flex-1 auto-rows-fr grid-cols-2 gap-2">
            <StatCard
              icon={Trophy}
              title={t("Universal Rank")}
              value={t("Top {percent}%", {
                percent: String(stats.topPercentile),
              })}
              colorClass="text-yellow-400"
              variants={item}
            />
            <StatCard
              icon={Zap}
              title={t("Longest Streak")}
              value={stats.longestStreak}
              colorClass="text-emerald-400"
              variants={item}
            />

            <StatCard
              icon={Activity}
              title={t("Total Grades")}
              value={stats.gradesCount}
              colorClass="text-pink-400"
              variants={item}
            />
            <StatCard
              icon={Calendar}
              title={t("Most Active Month")}
              value={formattedMostActiveMonth}
              colorClass="text-purple-400"
              variants={item}
            />
            <StatCard
              icon={Star}
              title={t("Total Points")}
              value={stats.gradesSum.toFixed(0)}
              colorClass="text-blue-400"
              variants={item}
            />
            <StatCard
              icon={Target}
              title={t("Global Average")}
              value={stats.average?.toFixed(2) || t("No data yet")}
              colorClass="text-teal-400"
              variants={item}
            />
            <StatCard
              icon={Rocket}
              title={t("Top Subject")}
              value={stats.bestSubjects[0]?.name || t("No data yet")}
              colorClass="text-cyan-400"
              truncate={true}
              className="col-span-2"
              variants={item}
            />
          </div>

          <div>
            {/* Award Card */}
            <motion.div
              variants={item}
              className={cn(
                "col-span-2 flex items-center justify-between gap-2 rounded-lg bg-[#161b22] p-2.5",
                award.bg.replace(/border-[a-z]+-[0-9]+\/[0-9]+/g, "")
              )}
              style={{
                boxShadow: `inset 0 0 0 1px ${getAwardBorderColor(award.color)}`,
              }}
            >
              <div className="flex min-w-0 flex-1 flex-col items-start text-left">
                <div
                  className={cn(
                    "mb-1 text-xs font-bold tracking-wider uppercase",
                    award.color
                  )}
                >
                  {award.title}
                </div>
                <div className="w-full truncate text-lg leading-tight font-bold text-white">
                  {award.condition}
                </div>
              </div>
              <Icon className={cn("h-10 w-10 shrink-0", award.color)} />
            </motion.div>
          </div>

          <div className="mt-2 shrink-0 text-xs text-[#8b949e]">
            avermate.fr
          </div>
        </motion.div>
      </div>

      {/* Buttons (not captured) - sized for canonical viewport */}
      <div className="mb-3 flex w-full shrink-0 gap-2">
        <Button
          className="h-10 flex-1 rounded-lg border-none bg-white text-sm font-bold text-black hover:bg-gray-200"
          onClick={(e) => {
            e.stopPropagation()
            handleShare()
          }}
          disabled={isSharing}
        >
          <Share2 className="mr-1.5 h-3.5 w-3.5" />{" "}
          {isSharing ? t("Generating...") : t("Share Image")}
        </Button>

        <Button
          variant="outline"
          className="h-10 flex-1 rounded-lg border-none bg-[#21262d] text-sm text-white hover:bg-[#30363d]"
          style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.2)" }}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          {t("Close")}
        </Button>
      </div>
    </div>
  )
}

// ... Main Story Component ... (keep as is)
function CanonicalYearReviewStory({
  stats,
  year,
  yearStartDate,
  yearEndDate,
  isOpen,
  onClose,
  userName,
  userAvatar,
}: CanonicalYearReviewStoryProps) {
  const t = useExtracted()
  const [currentSlide, setCurrentSlide] = useState(0)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const [isNavigating, setIsNavigating] = useState(false)
  const [isMuted, setIsMuted] = useState(false) // Start with music enabled by default
  // Track animated bar states: { index: targetProgress }
  const [animatedBars, setAnimatedBars] = useState<Record<number, number>>({})
  const [stepDuration, setStepDuration] = useState(120) // Dynamic per-step duration
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const safeAreaRef = useRef<HTMLDivElement>(null)
  const storyContainerRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Get the complete layout with zoom compensation
  const layout = useStoryLayout(safeAreaRef, isOpen)

  const slides = useMemo(
    () => [
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
    ],
    []
  )

  const isLastSlide = currentSlide === slides.length - 1

  const CurrentComponent = slides[currentSlide].component

  // Initialize audio on mount
  useEffect(() => {
    audioRef.current = new Audio("/recap-music.mp3")
    audioRef.current.loop = true
    audioRef.current.volume = 0.5

    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  // Audio follows open, mute — and pause. A paused story is silent too;
  // that is what makes the pause real rather than a stopped progress bar.
  useEffect(() => {
    if (!audioRef.current) return

    if (isOpen && !isMuted && !paused) {
      audioRef.current.play().catch(() => {
        // Autoplay might be blocked, user will need to unmute manually
      })
    } else {
      audioRef.current.pause()
      if (!isOpen) {
        audioRef.current.currentTime = 0
      }
    }
  }, [isOpen, isMuted, paused])

  // The video pause. The motion library's JS animations — the looping orbs,
  // a mid-flight entrance, every spring — compute their progress from one
  // shared clock, `frameData.timestamp`, normally fed by performance.now().
  // While the story is open that clock is ours: `useManualTiming` hands it
  // over, and this loop advances it only while the story plays. Pause stops
  // the timestamp, and since every animation is a function of elapsed time,
  // every animation holds its exact frame; resume advances it again from
  // the same instant, so nothing jumps the way it would if the clock had
  // kept running underneath.
  const clockPausedRef = useRef(false)
  useEffect(() => {
    clockPausedRef.current = paused
  }, [paused])

  useEffect(() => {
    if (!isOpen) return
    MotionGlobalConfig.useManualTiming = true
    frameData.timestamp = performance.now()
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      if (!clockPausedRef.current) {
        // The same clamp the library applies: a background tab must not
        // fast-forward the story when it comes back.
        const delta = Math.max(Math.min(now - last, 40), 1)
        frameData.delta = delta
        frameData.timestamp += delta
      }
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      MotionGlobalConfig.useManualTiming = false
    }
  }, [isOpen])

  // The library promotes some transform and opacity tweens to the Web
  // Animations API, which runs on the compositor's clock, not the one
  // above. Those are paused animation by animation — and only the ones
  // caught running are resumed, so a finished entrance does not replay
  // when the story does.
  const pausedAnimationsRef = useRef<Animation[]>([])
  useEffect(() => {
    const root = storyContainerRef.current
    if (!root || typeof root.getAnimations !== "function") return
    if (paused) {
      const running = root
        .getAnimations({ subtree: true })
        .filter((animation) => animation.playState === "running")
      for (const animation of running) animation.pause()
      pausedAnimationsRef.current = running
      return
    }
    for (const animation of pausedAnimationsRef.current) {
      if (animation.playState === "paused") animation.play()
    }
    pausedAnimationsRef.current = []
  }, [paused])

  // Auto-progress using interval (only updates progress, doesn't change slides)
  useEffect(() => {
    if (paused || !isOpen || isNavigating) {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = null
      }
      return
    }

    const duration = slides[currentSlide].duration
    const intervalTime = 50
    const increment = (intervalTime / duration) * 100

    progressIntervalRef.current = setInterval(() => {
      setProgress((prev) => Math.min(prev + increment, 100))
    }, intervalTime)

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = null
      }
    }
  }, [currentSlide, paused, isOpen, isNavigating, slides])

  // Auto-advance when progress reaches 100 (but not on the last slide).
  // This state-driven boundary is part of the canonical story timeline.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (progress >= 100 && !isNavigating && !paused && isOpen) {
      if (currentSlide < slides.length - 1) {
        setCurrentSlide((prev) => prev + 1)
        setProgress(0)
      }
      // On last slide: progress stays at 100, doesn't auto-close
    }
  }, [progress, currentSlide, slides.length, isNavigating, paused, isOpen])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Total animation time is constant regardless of steps
  const TOTAL_ANIMATION_TIME = 350
  const MIN_STEP_DURATION = 60 // Minimum per-step to keep it visible

  // Cascading animation for multi-step navigation
  const animateToSlide = useCallback(
    (targetIndex: number) => {
      if (isNavigating || targetIndex === currentSlide) return
      if (targetIndex < 0 || targetIndex >= slides.length) return

      const steps = Math.abs(targetIndex - currentSlide)
      const direction = targetIndex > currentSlide ? "forward" : "backward"

      // For backward navigation, we need one extra step to animate the target bar too
      const totalSteps = direction === "backward" ? steps + 1 : steps

      // Calculate per-step duration: total time divided by steps, with a minimum
      const perStepDuration = Math.max(
        MIN_STEP_DURATION,
        Math.floor(TOTAL_ANIMATION_TIME / totalSteps)
      )
      setStepDuration(perStepDuration)

      setIsNavigating(true)

      if (direction === "forward") {
        // Going forward: fill bars one by one from currentSlide to targetIndex-1
        for (let i = 0; i < steps; i++) {
          const barIndex = currentSlide + i
          setTimeout(() => {
            setAnimatedBars((prev) => ({ ...prev, [barIndex]: 100 }))
          }, i * perStepDuration)
        }
      } else {
        // Going backward: empty bars one by one from currentSlide down to targetIndex (inclusive)
        // This includes the target bar so it smoothly animates to 0 before we land on it
        for (let i = 0; i <= steps; i++) {
          const barIndex = currentSlide - i
          setTimeout(() => {
            setAnimatedBars((prev) => ({ ...prev, [barIndex]: 0 }))
          }, i * perStepDuration)
        }
      }

      // After all animations complete, switch to target slide
      const totalTime = totalSteps * perStepDuration
      setTimeout(() => {
        setCurrentSlide(targetIndex)
        setProgress(0)
        setAnimatedBars({})
        setIsNavigating(false)
      }, totalTime + 30)
    },
    [currentSlide, isNavigating, slides.length]
  )

  const nextSlide = useCallback(() => {
    if (isNavigating) return
    if (currentSlide < slides.length - 1) {
      animateToSlide(currentSlide + 1)
    }
    // On last slide: do nothing (don't close)
  }, [currentSlide, slides.length, isNavigating, animateToSlide])

  const prevSlide = useCallback(() => {
    if (isNavigating) return
    if (currentSlide > 0) {
      animateToSlide(currentSlide - 1)
    }
  }, [currentSlide, isNavigating, animateToSlide])

  const goToSlide = useCallback(
    (targetIndex: number) => {
      animateToSlide(targetIndex)
    },
    [animateToSlide]
  )

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") nextSlide()
      if (e.key === "ArrowLeft") prevSlide()
      if (e.key === "Escape") onClose()
      if (e.key === " ") {
        e.preventDefault()
        setPaused((p) => !p)
      }
    }

    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown)
    }
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, nextSlide, prevSlide, onClose])

  const handleClick = (e: React.MouseEvent) => {
    if (e.defaultPrevented) return
    // The release at the end of a hold is not a tap.
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const width = rect.width

    if (x < width * 0.3) {
      prevSlide()
    } else if (x > width * 0.7) {
      nextSlide()
    }
  }

  // Press and hold to pause, the way every story format works: the timer,
  // the music, the shader and the CSS animations all stop together, and
  // letting go resumes them. A hold's release must not also navigate.
  const holdTimerRef = useRef<number | null>(null)
  const holdActiveRef = useRef(false)
  const suppressClickRef = useRef(false)

  const beginHold = (e: React.PointerEvent) => {
    // Holding a control is a press, not a story hold.
    if ((e.target as HTMLElement).closest("button")) return
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current)
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null
      holdActiveRef.current = true
      setPaused(true)
    }, 220)
  }

  const endHold = () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (holdActiveRef.current) {
      holdActiveRef.current = false
      suppressClickRef.current = true
      setPaused(false)
    }
  }

  // Get the display progress for a bar
  const getBarProgress = (index: number): number => {
    // Check if this bar is being animated
    if (index in animatedBars) {
      return animatedBars[index]
    }
    // Default states based on position relative to current slide
    if (index < currentSlide) return 100
    if (index > currentSlide) return 0
    // Current slide (not animating)
    return progress
  }

  if (!isOpen) return null

  const {
    storyScale,
    showNavButtons,
    storyRect,
    closeButtonRect,
    previousButtonRect,
    nextButtonRect,
  } = layout

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-black">
      {/*
                Layout structure:
                - Outer container remains full bleed behind system UI
                - The inner frame follows all four safe-area insets independently
                - All children use safe-area-local absolute coordinates
                - Button sizes are zoom-compensated to appear constant physical size
                - Story scales to fill available space after margins/buttons
            */}

      <div
        ref={safeAreaRef}
        className="absolute"
        style={{
          top: "var(--spacing-safe-top, 0px)",
          right: "var(--spacing-safe-right, 0px)",
          bottom: "var(--spacing-safe-bottom, 0px)",
          left: "var(--spacing-safe-left, 0px)",
        }}
      >
        {/* Close Button - positioned at top-right of story, zoom-compensated size */}
        <button
          onClick={onClose}
          className="absolute z-[110] flex items-center justify-center rounded-full bg-white/10 text-white/50 transition-colors outline-none hover:bg-white/20 hover:text-white focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          style={{
            width: closeButtonRect.width,
            height: closeButtonRect.height,
            top: closeButtonRect.y,
            left: closeButtonRect.x,
          }}
          aria-label={t("Close")}
        >
          <X
            style={{
              width: closeButtonRect.width * 0.5,
              height: closeButtonRect.height * 0.5,
            }}
          />
        </button>

        {/* Left Navigation Button - hidden on small screens, zoom-compensated size */}
        {showNavButtons && previousButtonRect && (
          <button
            onClick={prevSlide}
            className={`absolute z-[110] flex items-center justify-center rounded-full transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
              currentSlide === 0
                ? "cursor-not-allowed bg-white/5 text-white/20"
                : "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white"
            }`}
            style={{
              width: previousButtonRect.width,
              height: previousButtonRect.height,
              left: previousButtonRect.x,
              top: previousButtonRect.y,
            }}
            aria-label={t("Previous slide")}
            disabled={currentSlide === 0}
          >
            <ChevronLeft
              style={{
                width: previousButtonRect.width * 0.5,
                height: previousButtonRect.height * 0.5,
              }}
            />
          </button>
        )}

        {/* Right Navigation Button - hidden on small screens, zoom-compensated size */}
        {showNavButtons && nextButtonRect && (
          <button
            onClick={nextSlide}
            className={`absolute z-[110] flex items-center justify-center rounded-full transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
              isLastSlide
                ? "cursor-not-allowed bg-white/5 text-white/20"
                : "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white"
            }`}
            style={{
              width: nextButtonRect.width,
              height: nextButtonRect.height,
              left: nextButtonRect.x,
              top: nextButtonRect.y,
            }}
            aria-label={t("Next slide")}
            disabled={isLastSlide}
          >
            <ChevronRight
              style={{
                width: nextButtonRect.width * 0.5,
                height: nextButtonRect.height * 0.5,
              }}
            />
          </button>
        )}

        {/* Ambilight + Story Container wrapper - centered */}
        <div
          className="absolute"
          style={{
            left: storyRect.x,
            top: storyRect.y,
            transform: `scale(${storyScale})`,
            transformOrigin: "top left",
          }}
        >
          <AmbilightWrapper>
            {/* Story Content */}
            <div
              ref={storyContainerRef}
              className={`cursor-pointer overflow-hidden bg-black shadow-2xl select-none ${
                paused ? "story-paused" : ""
              }`}
              style={
                {
                  width: CANONICAL_WIDTH,
                  height: CANONICAL_HEIGHT,
                  borderRadius: 24,
                  // Additional GPU hints
                  willChange: "transform",
                  backfaceVisibility: "hidden",
                  // CSS variable for inverse scale
                  "--border-scale": storyScale > 0 ? 1 / storyScale : 1,
                } as CSSProperties
              }
              onClick={handleClick}
              onPointerDown={beginHold}
              onPointerUp={endHold}
              onPointerCancel={endHold}
              onPointerLeave={endHold}
            >
              {/* Scrims: the chrome reads on any slide without dimming it. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 z-[15] h-20 rounded-t-[24px] bg-gradient-to-b from-black/50 via-black/20 to-transparent"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] h-14 rounded-b-[24px] bg-gradient-to-t from-black/40 to-transparent"
              />

              {/* Progress Bars */}
              <div className="absolute top-0 right-0 left-0 z-20 flex gap-1 p-2">
                {slides.map((_, index) => {
                  const barProgress = getBarProgress(index)
                  return (
                    <button
                      key={index}
                      className="group h-3 flex-1 cursor-pointer overflow-hidden rounded-full bg-transparent py-1 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
                      onClick={(e) => {
                        e.stopPropagation()
                        goToSlide(index)
                      }}
                      aria-label={t("Go to slide {number}", {
                        number: String(index + 1),
                      })}
                    >
                      <div className="h-1 w-full overflow-hidden rounded-full bg-white/30 transition-colors group-hover:bg-white/40">
                        <div
                          className="h-full bg-white"
                          style={{
                            width: `${barProgress}%`,
                            transition: isNavigating
                              ? `width ${stepDuration}ms linear`
                              : "width 50ms linear",
                          }}
                        />
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Pause Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setPaused((p) => !p)
                }}
                className="absolute top-8 right-2 z-20 rounded-full bg-black/30 p-1.5 text-white/70 backdrop-blur-sm outline-none hover:text-white focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
                aria-label={paused ? t("Play") : t("Pause")}
              >
                {paused ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
              </button>

              {/* Music/Mute Button — grouped with pause, under the bars. */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsMuted((m) => !m)
                }}
                className="absolute top-8 right-11 z-20 flex items-center justify-center rounded-full bg-black/30 p-1.5 text-white/70 backdrop-blur-sm outline-none hover:text-white focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
                aria-label={isMuted ? t("Unmute") : t("Mute")}
              >
                <MusicBarsIcon isMuted={isMuted} />
              </button>

              {/* Content */}
              <div className="relative z-10 h-full w-full">
                <StoryPausedContext.Provider value={paused}>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentSlide}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="h-full w-full"
                    >
                      <CurrentComponent
                        stats={stats}
                        year={year}
                        yearStartDate={yearStartDate}
                        yearEndDate={yearEndDate}
                        onClose={onClose}
                        userName={userName}
                        userAvatar={userAvatar}
                        paused={paused}
                      />
                    </motion.div>
                  </AnimatePresence>
                </StoryPausedContext.Provider>
              </div>
            </div>
          </AmbilightWrapper>
        </div>
      </div>
    </div>
  )
}

function canonicalStats(review: YearReview, year: Year): YearReviewStats {
  const fallbackDate = review.firstGradeAt ?? year.startsAt
  const primeTime = review.primeTime ?? {
    date: fallbackDate,
    ratio: review.average ?? 0,
  }

  return {
    gradesCount: review.gradeCount,
    gradesSum: review.ratioSum * CANONICAL_SCALE,
    heatmap: review.heatmap,
    mostActiveMonth: review.busiestMonth ?? {
      month: `${fallbackDate.getFullYear()}-${String(fallbackDate.getMonth() + 1).padStart(2, "0")}`,
      count: 0,
    },
    mostActiveDay: {
      day: String(review.busiestWeekday?.weekday ?? 0),
      count: review.busiestWeekday?.count ?? 0,
    },
    longestStreak: review.longestStreak,
    primeTime: {
      date: primeTime.date,
      value: primeTime.ratio * CANONICAL_SCALE,
    },
    averageSeries: review.averageSeries.map((point) => ({
      date: point.date,
      value: point.ratio * CANONICAL_SCALE,
    })),
    bestSubjects: review.topSubjects.map((subject) => ({
      name: subject.name,
      value: subject.ratio * CANONICAL_SCALE,
    })),
    bestProgression: review.bestProgression
      ? {
          subject: review.bestProgression.name,
          value: review.bestProgression.delta * CANONICAL_SCALE,
        }
      : { subject: "", value: 0 },
    topPercentile: Math.max(1, review.topPercentile),
    average: (review.average ?? 0) * CANONICAL_SCALE,
    awardType: review.award,
  }
}

export function YearReviewStory({
  review,
  reviewKey,
  year,
  onClose,
}: YearReviewStoryProps) {
  const user = useAuthenticatedUser()
  const markSeen = useMutation(orpc.review.markSeen.mutationOptions())
  const markedKey = useRef<string | null>(null)
  const stats = useMemo(() => canonicalStats(review, year), [review, year])

  useEffect(() => {
    if (!reviewKey || markedKey.current === reviewKey) return
    markedKey.current = reviewKey
    markSeen.mutate({ yearId: year.id, reviewKey })
  }, [markSeen, reviewKey, year.id])

  return (
    <CanonicalYearReviewStory
      stats={stats}
      year={year.name}
      yearStartDate={year.startsAt}
      yearEndDate={year.endsAt}
      isOpen
      onClose={onClose}
      userName={user.name}
      userAvatar={user.image ?? undefined}
    />
  )
}
