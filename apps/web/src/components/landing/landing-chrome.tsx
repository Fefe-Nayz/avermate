"use client"

import { useRef, useSyncExternalStore, type ReactNode } from "react"
import { useInView } from "motion/react"
import { CheckIcon } from "lucide-react"
import LightRays from "@/components/light-rays"
import { BlurFade } from "@/components/ui/blur-fade"
import { BorderBeam } from "@/components/ui/border-beam"
import { DotPattern } from "@/components/ui/dot-pattern"
import { MagicCard } from "@/components/ui/magic-card"
import { Marquee } from "@/components/ui/marquee"
import { ShineBorder } from "@/components/ui/shine-border"
import { cn } from "@/lib/utils"

/**
 * The landing's shared furniture.
 *
 * Everything visual here is one of the animation components the project now
 * carries — BlurFade, BorderBeam, DotPattern, MagicCard, LightRays — rather
 * than a one-off approximation of them. They all suspend themselves off-screen,
 * on a hidden tab, and under `prefers-reduced-motion`, so a landing page full
 * of movement still costs nothing when nobody is looking at it.
 */

/**
 * The resolved value of a theme token, as a hex string.
 *
 * Only WebGL needs this. Every CSS-based effect here — the beam, the shine,
 * the magic card — interpolates its colours into a gradient, so those take
 * `var(--primary)` directly and follow the palette for free. The rays upload a
 * uniform to a shader and need three actual numbers.
 *
 * The browser does the conversion: assigning any CSS colour to a canvas
 * context and reading it back yields `#rrggbb`, oklch included. It is modelled
 * as an external store rather than an effect because it genuinely is one —
 * the value changes when the reader switches palette or theme, and the
 * mutation observer is what notices.
 */
const hexCache = new Map<string, string>()

function resolveTokenHex(token: string, fallback: string): string {
  if (typeof document === "undefined") return fallback
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim()
  if (!raw) return fallback

  const cached = hexCache.get(raw)
  if (cached) return cached

  const context = document.createElement("canvas").getContext("2d")
  if (!context) return fallback
  context.fillStyle = raw
  const resolved = context.fillStyle
  const hex = typeof resolved === "string" ? resolved : fallback
  hexCache.set(raw, hex)
  return hex
}

function subscribeToTheme(onChange: () => void) {
  if (typeof document === "undefined") return () => undefined
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-palette", "data-season"],
  })
  return () => observer.disconnect()
}

export function useTokenHex(token: string, fallback = "#7c8cff") {
  return useSyncExternalStore(
    subscribeToTheme,
    () => resolveTokenHex(token, fallback),
    () => fallback
  )
}

/** Content that arrives as you reach it. Once only, never on the way back up. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  return (
    <BlurFade inView delay={delay} duration={0.5} offset={14} className={className}>
      {children}
    </BlurFade>
  )
}

/** A small monospace label. It names the section without competing with it. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[11px] font-medium tracking-[0.22em] text-muted-foreground uppercase">
      {children}
    </p>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  id,
}: {
  eyebrow: string
  title: string
  description?: string
  align?: "center" | "left"
  id?: string
}) {
  return (
    <Reveal
      className={cn(
        align === "center" && "mx-auto max-w-2xl text-center",
        align === "left" && "max-w-2xl"
      )}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        id={id}
        className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-4 leading-relaxed text-pretty text-muted-foreground">
          {description}
        </p>
      ) : null}
    </Reveal>
  )
}

/**
 * The seam between two sections: a hairline with a comet running its length.
 *
 * The beam traces the perimeter of a one-pixel box, so it sweeps one way along
 * the top edge and back along the bottom — which on a hairline reads as a
 * single light passing through. It parks itself when the seam is off-screen.
 */
export function BeamDivider({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative h-px w-full overflow-hidden bg-border/60",
        className
      )}
    >
      <BorderBeam
        size={220}
        duration={9}
        colorFrom="var(--primary)"
        colorTo="var(--chart-2)"
      />
    </div>
  )
}

/**
 * The light behind the hero.
 *
 * Real volumetric rays on the palette's own accent, with a soft gradient
 * underlay so the section still reads before WebGL is up — or at all, if the
 * device refuses it.
 */
export function HeroBackdrop() {
  const primary = useTokenHex("--primary")

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[52rem] overflow-hidden"
    >
      <div className="absolute top-[-22rem] left-1/2 size-[48rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute top-16 left-[10%] size-72 rounded-full bg-chart-2/10 blur-3xl" />
      <div className="absolute top-24 right-[6%] size-80 rounded-full bg-positive/8 blur-3xl" />
      <LightRays
        raysOrigin="top-center"
        raysColor={primary}
        raysSpeed={0.7}
        lightSpread={0.4}
        rayLength={1.15}
        followMouse
        mouseInfluence={0.3}
        noiseAmount={0.05}
        distortion={0.03}
        className="opacity-30 dark:opacity-45"
      />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
    </div>
  )
}

/** A faint dot field, masked to the middle so it never collides with an edge. */
export function BackgroundDots({ className }: { className?: string }) {
  return (
    <DotPattern
      width={28}
      height={28}
      cr={0.7}
      className={cn(
        "text-foreground/[0.09] [mask-image:radial-gradient(ellipse_60%_120%_at_center,black,transparent_75%)]",
        className
      )}
    />
  )
}

export function TrustItem({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <CheckIcon className="size-3.5 text-positive" />
      {children}
    </span>
  )
}

/**
 * A bento tile: an illustration on top, the claim underneath, an index in the
 * corner. The card lights where the pointer is — which on a grid of nine tiles
 * is the cheapest possible way to say "this one".
 */
export function BentoCard({
  index,
  title,
  description,
  visual,
  className,
  delay = 0,
}: {
  index: string
  title: string
  description: string
  visual: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <Reveal delay={delay} className={className}>
      <MagicCard
        gradientFrom="var(--primary)"
        gradientTo="var(--chart-2)"
        gradientSize={220}
        gradientOpacity={0.09}
        className="h-full rounded-2xl"
        plateClassName="bg-card"
      >
        <article className="group flex h-full flex-col">
          <div className="min-h-40 flex-1 p-5 pb-0 transition-transform duration-500 ease-out group-hover:-translate-y-0.5">
            {visual}
          </div>
          <div className="p-5 pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-semibold tracking-tight">{title}</h3>
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground/50 select-none">
                {index}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        </article>
      </MagicCard>
    </Reveal>
  )
}

/**
 * The browser frame around the live preview.
 *
 * The beam traces its perimeter once you reach it. It is doing a job here
 * rather than decorating: the frame is the one element on the page a visitor
 * might mistake for a screenshot, and something moving around its edge says
 * "running" before the numbers inside do.
 */
export function PreviewFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border bg-card/60 p-2 shadow-[0_32px_100px_-42px_rgba(0,0,0,.45)] backdrop-blur sm:p-3">
      <BorderBeam
        size={340}
        duration={12}
        colorFrom="var(--primary)"
        colorTo="var(--chart-2)"
      />
      {children}
    </div>
  )
}

/** A card whose border catches the light, for the three standing claims. */
export function PrincipleCard({
  children,
  delay = 0,
  index = 0,
}: {
  children: ReactNode
  delay?: number
  index?: number
}) {
  return (
    <Reveal delay={delay}>
      <div className="relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-5">
        <ShineBorder
          borderWidth={1}
          duration={18 + index * 2}
          shineColor={[
            "var(--primary)",
            "var(--chart-2)",
            "var(--positive)",
          ]}
          className="opacity-40 dark:opacity-55"
        />
        {children}
      </div>
    </Reveal>
  )
}

/**
 * The subjects strip.
 *
 * A quiet band of the things people actually track, drifting past. It is the
 * one place on the page where the product's vocabulary appears without a
 * number attached — proof that "any subject, any structure" is not marketing.
 */
export function SubjectMarquee({ subjects }: { subjects: readonly string[] }) {
  return (
    <div className="relative overflow-hidden border-y border-border/60 bg-muted/20 py-3">
      <Marquee pauseOnHover className="[--duration:48s] [--gap:2.5rem]">
        {subjects.map((subject) => (
          <span
            key={subject}
            className="font-mono text-xs tracking-[0.14em] text-muted-foreground/70 uppercase"
          >
            {subject}
          </span>
        ))}
      </Marquee>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent" />
    </div>
  )
}

/** Counts up once it is actually on screen, so nobody misses the animation. */
export function useOnScreen<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const inView = useInView(ref, { amount: 0.5, once: true })
  return { ref, inView }
}
