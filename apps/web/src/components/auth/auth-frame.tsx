"use client"

import type { ReactNode } from "react"
import { useTokenHex } from "@/components/landing/landing-chrome"
import LightRays from "@/components/light-rays"
import { BlurFade } from "@/components/ui/blur-fade"
import { BorderBeam } from "@/components/ui/border-beam"
import { DotPattern } from "@/components/ui/dot-pattern"

/**
 * The decoration around the sign-in card.
 *
 * Same materials as the landing page — rays, dot field, traced border — so
 * arriving here from the marketing site does not feel like landing on a
 * different product. It stays a thin client shell so the auth routes
 * themselves remain server-rendered.
 */
export function AuthBackdrop() {
  const primary = useTokenHex("--primary")

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <DotPattern
        width={30}
        height={30}
        cr={0.7}
        className="[mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent_75%)] text-foreground/[0.06]"
      />
      <div className="absolute top-[-24rem] left-1/2 size-[46rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute right-[-8rem] bottom-[-12rem] size-[32rem] rounded-full bg-chart-2/8 blur-3xl" />
      <LightRays
        raysOrigin="top-center"
        raysColor={primary}
        raysSpeed={0.55}
        lightSpread={0.5}
        rayLength={0.9}
        followMouse
        mouseInfluence={0.2}
        noiseAmount={0.05}
        distortion={0.02}
        className="opacity-25 dark:opacity-40"
      />
    </div>
  )
}

/** The card itself: entrance, and a light tracing its edge once it settles. */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <BlurFade inView duration={0.5} offset={12}>
      <div className="relative overflow-hidden rounded-2xl border bg-card shadow-xl shadow-black/5">
        <BorderBeam
          size={260}
          duration={11}
          colorFrom="var(--primary)"
          colorTo="var(--chart-2)"
        />
        <div className="grid md:grid-cols-2">{children}</div>
      </div>
    </BlurFade>
  )
}
