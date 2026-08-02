import Link from "next/link";
import {
  ArrowRightIcon,
  ChartNoAxesCombinedIcon,
  GraduationCapIcon,
  LayersIcon,
  SmartphoneIcon,
  SparklesIcon,
  TargetIcon,
} from "lucide-react";
import { useExtracted } from "next-intl";
import { Button } from "@/components/ui/button";
import { LandingStats } from "@/components/landing/landing-stats";
import { LandingPreview } from "@/components/landing/landing-preview";

export default function LandingPage() {
  const t = useExtracted();

  const features = [
    {
      icon: LayersIcon,
      title: t("Weighting that matches your school"),
      body: t(
        "Nest subjects as deeply as you need, group them into categories that add no level of averaging, and give anything its own coefficient.",
      ),
    },
    {
      icon: TargetIcon,
      title: t("Goals that tell you what to do"),
      body: t(
        "Set a target and Avermate works out the mark your next assessment needs, which subject is worth the effort, and when a target has stopped being reachable.",
      ),
    },
    {
      icon: ChartNoAxesCombinedIcon,
      title: t("Every number explained"),
      body: t(
        "See what a single grade did to your year, which subject carries the most weight, and where your average is heading.",
      ),
    },
    {
      icon: SmartphoneIcon,
      title: t("Built for a phone, not shrunk onto one"),
      body: t(
        "A real mobile app in the browser: thumb-reachable navigation, full-screen forms, and haptics.",
      ),
    },
  ];

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCapIcon className="size-4" />
            </span>
            Avermate
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" render={<Link href="/auth/sign-in" />}>
              {t("Sign in")}
            </Button>
            <Button size="sm" render={<Link href="/auth/sign-up" />}>
              {t("Get started")}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4">
        <section className="flex flex-col items-center gap-6 py-16 text-center md:py-24">
          <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
            {t("Free, and your grades stay yours")}
          </span>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
            {t("Know exactly where you stand.")}
          </h1>
          <p className="max-w-xl text-balance text-muted-foreground md:text-lg">
            {t(
              "Track your grades, understand what moves your average, and get a plan for the result you are aiming at.",
            )}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" render={<Link href="/auth/sign-up" />}>
              {t("Start for free")}
              <ArrowRightIcon className="size-4" />
            </Button>
            <Button variant="outline" size="lg" render={<Link href="/auth/sign-in" />}>
              {t("I already have an account")}
            </Button>
          </div>
          <LandingStats />
        </section>

        <LandingPreview />

        <section className="grid gap-4 py-16 md:grid-cols-2">
          {features.map((feature) => (
            <div key={feature.title} className="rounded-2xl border bg-card p-6">
              <feature.icon className="size-5 text-primary" />
              <h2 className="mt-3 font-medium">{feature.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {feature.body}
              </p>
            </div>
          ))}
        </section>

        <section className="flex flex-col items-center gap-5 rounded-2xl border bg-card px-6 py-14 text-center">
          <SparklesIcon className="size-6 text-primary" />
          <h2 className="max-w-lg text-2xl font-semibold tracking-tight md:text-3xl">
            {t("Your year, in one number you can trust.")}
          </h2>
          <Button size="lg" render={<Link href="/auth/sign-up" />}>
            {t("Create your account")}
            <ArrowRightIcon className="size-4" />
          </Button>
        </section>
      </main>

      <footer className="mx-auto mt-16 w-full max-w-5xl px-4 pb-10">
        <div className="flex flex-col gap-3 border-t pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} Avermate</p>
          <nav className="flex gap-4 sm:ml-auto">
            <Link href="/legal/privacy" className="hover:text-foreground">
              {t("Privacy")}
            </Link>
            <Link href="/legal/terms" className="hover:text-foreground">
              {t("Terms")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
