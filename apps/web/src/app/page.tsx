import type { Metadata } from "next"
import Link from "next/link"
import { Suspense, type ReactNode } from "react"
import {
  ArrowRightIcon,
  BookOpenCheckIcon,
  ChartNoAxesCombinedIcon,
  ChevronDownIcon,
  GraduationCapIcon,
  LockKeyholeIcon,
  RouteIcon,
  SmartphoneIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import {
  BeamDivider,
  BentoCard,
  HeroBackdrop,
  PreviewFrame,
  PrincipleCard,
  Reveal,
  SectionHeading,
  SubjectMarquee,
  TrustItem,
} from "@/components/landing/landing-chrome"
import {
  CompositeVisual,
  DashboardVisual,
  EverywhereVisual,
  GoalVisual,
  ImpactVisual,
  ProjectionVisual,
  RecapVisual,
  TimeTravelVisual,
  TrendVisual,
  WeightingVisual,
} from "@/components/landing/feature-visuals"
import { LandingHeader } from "@/components/landing/landing-header"
import { LandingPreview } from "@/components/landing/landing-preview"
import { LandingStats } from "@/components/landing/landing-stats"
import { Button } from "@/components/ui/button"
import { NoiseTexture } from "@/components/ui/noise-texture"

export const metadata: Metadata = {
  title: "Avermate — Understand every grade",
  description:
    "Track grades with your school's real weighting, understand every change in your average, and build a plan toward your goals.",
}

/**
 * The public landing page.
 *
 * Two decisions shape everything here. First, it is image-free: every visual
 * is a component drawing real shapes, so nothing is a screenshot of somebody's
 * marks and nothing goes stale when the product moves. Second, the hero shows
 * the actual calculation engine running on an invented year — the only honest
 * way to demonstrate a calculator is to let it calculate.
 *
 * It stays a Server Component so the copy and the counters are in the HTML;
 * only the pieces that genuinely move are client islands.
 */
export default function LandingPage() {
  const t = useExtracted()

  const questions = [
    {
      question: t("Will it calculate the same average as my school?"),
      answer: t(
        "Avermate follows the subjects, categories, periods and coefficients you configure. If your school exposes its weighting, you can reproduce it closely; its official report still remains the reference."
      ),
    },
    {
      question: t("Do grades have to be out of 20?"),
      answer: t(
        "No. Set the scale for each year, and individual grades can use a different maximum. Avermate normalises them before applying coefficients."
      ),
    },
    {
      question: t("Can I track composite assessments?"),
      answer: t(
        "Yes. An assessment can contain written, oral or exercise components, each with its own maximum and coefficient."
      ),
    },
    {
      question: t("What happens to my data?"),
      answer: t(
        "Your school data is used to calculate your own averages and goals. It is not sold to advertisers, and account settings let you export or delete it."
      ),
    },
    {
      question: t("Is Avermate free?"),
      answer: t(
        "Yes. You can create an account, configure a year and use the grade, analytics and goal tools without a paid plan."
      ),
    },
  ]

  return (
    <div className="min-h-svh overflow-x-hidden bg-background">
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:top-[calc(var(--spacing-safe-top)+0.75rem)] focus:left-[calc(var(--spacing-safe-left)+0.75rem)]"
      >
        {t("Skip to content")}
      </a>

      <LandingHeader />

      <main id="content">
        {/* ------------------------------------------------------ hero */}
        <section className="relative isolate">
          <HeroBackdrop />

          <div className="mx-auto flex max-w-6xl flex-col items-center pt-14 pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] text-center sm:pt-20 sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))]">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
                <SparklesIcon className="size-3.5 text-primary" />
                {t("Your grades finally explain themselves")}
              </span>
            </Reveal>

            <Reveal delay={0.06}>
              <h1 className="mt-7 max-w-4xl text-4xl leading-[1.05] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-7xl">
                {t("Know where you stand — and what to do next.")}
              </h1>
            </Reveal>

            <Reveal delay={0.12}>
              <p className="mt-6 max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
                {t(
                  "Avermate follows your school's real weighting, explains every movement in your average, and turns the result you want into a practical plan."
                )}
              </p>
            </Reveal>

            <Reveal delay={0.18}>
              <div className="mt-8 flex w-full max-w-md flex-col gap-2 sm:w-auto sm:max-w-none sm:flex-row">
                <Button
                  size="lg"
                  className="sm:min-w-44"
                  render={<Link href="/auth/sign-up" />}
                >
                  {t("Start for free")}
                  <ArrowRightIcon className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="sm:min-w-44"
                  render={<Link href="#preview" />}
                >
                  {t("See it in action")}
                </Button>
              </div>
            </Reveal>

            <Reveal delay={0.24}>
              <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                <TrustItem>{t("Free to use")}</TrustItem>
                <TrustItem>{t("No credit card")}</TrustItem>
                <TrustItem>{t("Your data stays yours")}</TrustItem>
              </div>
            </Reveal>
          </div>

          {/* The product itself, in a browser frame. Not a picture of one. */}
          <div
            id="preview"
            className="mx-auto mt-14 max-w-6xl scroll-mt-24 pr-[max(0.5rem,var(--spacing-safe-right))] pb-20 pl-[max(0.5rem,var(--spacing-safe-left))] sm:mt-18 sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))]"
          >
            <Reveal delay={0.1}>
              <PreviewFrame>
                <div className="flex items-center gap-1.5 border-b px-3 py-2.5">
                  <span className="size-2.5 rounded-full bg-destructive/70" />
                  <span className="size-2.5 rounded-full bg-band-fair/80" />
                  <span className="size-2.5 rounded-full bg-band-excellent/75" />
                  <span className="mx-auto -translate-x-4 rounded-md bg-muted px-12 py-1 font-mono text-[10px] text-muted-foreground">
                    avermate.fr
                  </span>
                </div>
                <div className="overflow-hidden rounded-b-[1.25rem]">
                  <LandingPreview />
                </div>
              </PreviewFrame>
              <p className="mt-4 text-center text-xs text-muted-foreground">
                {t(
                  "A worked example powered by Avermate's real calculation engine — not a picture of one."
                )}
              </p>
            </Reveal>
          </div>
        </section>

        <Suspense fallback={null}>
          <LandingStats />
        </Suspense>

        <SubjectMarquee
          subjects={[
            t("Mathematics"),
            t("Physics-Chemistry"),
            t("Philosophy"),
            t("History-Geography"),
            t("Life sciences"),
            t("English"),
            t("Spanish"),
            t("Economics"),
            t("Literature"),
            t("Computer science"),
            t("Physical education"),
            t("Engineering sciences"),
          ]}
        />

        {/* ------------------------------------------------------- why */}
        <section id="why" className="scroll-mt-20">
          <div className="mx-auto grid max-w-6xl gap-12 py-20 pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))] lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:py-28">
            <div>
              <SectionHeading
                align="left"
                id="why-title"
                eyebrow={t("More than a calculator")}
                title={t("A number is useful. Understanding it is better.")}
                description={t(
                  "A spreadsheet can produce an average. Avermate keeps the structure behind it, shows what changed it, and helps you decide where your next hour matters most."
                )}
              />
              <Reveal delay={0.1}>
                <div className="mt-8 grid gap-3">
                  <ComparisonRow
                    icon={<ChartNoAxesCombinedIcon />}
                    title={t("See the cause")}
                    body={t(
                      "Open any grade or subject to see its effect on the year."
                    )}
                  />
                  <ComparisonRow
                    icon={<RouteIcon />}
                    title={t("Choose the route")}
                    body={t(
                      "Goals compare what one result or several future results would need."
                    )}
                  />
                  <ComparisonRow
                    icon={<BookOpenCheckIcon />}
                    title={t("Keep the real rules")}
                    body={t(
                      "Periods, nested subjects and composite assessments stay part of the model."
                    )}
                  />
                </div>
              </Reveal>
            </div>

            <Reveal delay={0.14} className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border bg-card p-4">
                <p className="mb-3 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                  {t("Projection")}
                </p>
                <div className="h-40">
                  <ProjectionVisual />
                </div>
              </div>
              <div className="rounded-2xl border bg-card p-4">
                <p className="mb-3 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                  {t("Early warning")}
                </p>
                <div className="h-40">
                  <TrendVisual />
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <BeamDivider />

        {/* -------------------------------------------------- features */}
        <section id="features" className="scroll-mt-20 bg-muted/25">
          <div className="mx-auto max-w-6xl py-20 pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))] lg:py-28">
            <SectionHeading
              id="features-title"
              eyebrow={t("Built around a whole school year")}
              title={t(
                "The detail when you need it. The answer when you do not."
              )}
              description={t(
                "Nine things Avermate does that a spreadsheet quietly refuses to."
              )}
            />

            <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <BentoCard
                className="lg:col-span-2"
                index="01"
                title={t("Weighting that matches your school")}
                description={t(
                  "Subjects, categories and sub-subjects nested as deeply as you need. A category weighs its children at the top rather than averaging them first — which is exactly where a spreadsheet goes wrong."
                )}
                visual={<WeightingVisual />}
              />
              <BentoCard
                delay={0.08}
                index="02"
                title={t("Goals that turn into a plan")}
                description={t(
                  "Pick a target and read the grade it would take next, or across several assessments — and whether it is still reachable at all."
                )}
                visual={<GoalVisual />}
              />
              <BentoCard
                index="03"
                title={t("See what moved the average")}
                description={t(
                  "Every grade and subject carries its own effect on the year, signed and measured."
                )}
                visual={<ImpactVisual />}
              />
              <BentoCard
                className="lg:col-span-2"
                delay={0.08}
                index="04"
                title={t("A dashboard that is actually yours")}
                description={t(
                  "Choose the cards, choose how much room each gets, and reorder them around the way you follow your year. It stays that way on every device."
                )}
                visual={<DashboardVisual />}
              />
              <BentoCard
                className="lg:col-span-2"
                index="05"
                title={t("Go back to any day")}
                description={t(
                  "Time travel hides later results across the whole app, so you can see exactly where you stood the week before an assessment — not a filtered list, the entire app as it was."
                )}
                visual={<TimeTravelVisual />}
              />
              <BentoCard
                delay={0.08}
                index="06"
                title={t("Composite assessments")}
                description={t(
                  "Written, oral and practical parts, each with its own maximum and coefficient, resolving to one mark."
                )}
                visual={<CompositeVisual />}
              />
              <BentoCard
                index="07"
                title={t("One engine, desktop to phone")}
                description={t(
                  "The web and mobile apps share the same calculation model and the same account."
                )}
                visual={<EverywhereVisual />}
              />
              <BentoCard
                delay={0.08}
                index="08"
                title={t("A year worth remembering")}
                description={t(
                  "Your recap turns the year into a story you can keep: activity, strongest subjects, best run, progression and a title of your own."
                )}
                visual={<RecapVisual />}
              />
              <BentoCard
                delay={0.16}
                index="09"
                title={t("Insights, not decoration")}
                description={t(
                  "Impact, consistency, progression, distribution and projection — without rebuilding the maths in a spreadsheet."
                )}
                visual={<ProjectionVisual />}
              />
            </div>
          </div>
        </section>

        <BeamDivider />

        {/* ------------------------------------------------ principles */}
        <section>
          <div className="mx-auto grid max-w-6xl gap-4 py-16 pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))] md:grid-cols-3">
            <Principle
              icon={<ZapIcon />}
              title={t("The maths is the product")}
              body={t(
                "One engine computes every average, goal and projection, shared by the web app, the phone app and the API. There is no second implementation to disagree with the first."
              )}
            />
            <Principle
              delay={0.08}
              index={1}
              icon={<LockKeyholeIcon />}
              title={t("Your marks stay yours")}
              body={t(
                "School data is used to answer your own questions. It is not sold to advertisers, and you can export it or delete the account outright."
              )}
              link={{
                href: "/legal/privacy",
                label: t("Read the privacy policy"),
              }}
            />
            <Principle
              delay={0.16}
              index={2}
              icon={<SmartphoneIcon />}
              title={t("Free, and honest about it")}
              body={t(
                "Create an account, configure a year, and use the grade, analytics and goal tools without a paid plan or a card."
              )}
            />
          </div>
        </section>

        {/* -------------------------------------------------- how it works */}
        <section id="how" className="scroll-mt-20 border-y bg-card">
          <div className="mx-auto max-w-6xl py-20 pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))] lg:py-28">
            <SectionHeading
              id="how-title"
              eyebrow={t("From blank page to useful answer")}
              title={t("Set up once. Learn from every result after that.")}
            />
            <ol className="mt-14 grid gap-8 md:grid-cols-3">
              <Step
                number="01"
                title={t("Describe your year")}
                body={t(
                  "Start from a school template or create your own subjects, periods, scale and coefficients."
                )}
              />
              <Step
                delay={0.08}
                number="02"
                title={t("Record results")}
                body={t(
                  "Add a simple or composite grade. Avermate files it into the right period and updates every related view."
                )}
              />
              <Step
                delay={0.16}
                number="03"
                title={t("Act on the answer")}
                body={t(
                  "Review impact and trends, then set a target to see the most useful next move."
                )}
              />
            </ol>
          </div>
        </section>

        {/* --------------------------------------------------------- faq */}
        <section
          id="faq"
          className="mx-auto max-w-4xl scroll-mt-20 py-20 pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))] lg:py-28"
        >
          <SectionHeading
            id="faq-title"
            eyebrow={t("Questions, answered")}
            title={t("Before you add your first grade")}
          />
          <Reveal delay={0.1}>
            <div className="mt-12 divide-y rounded-2xl border bg-card px-5 sm:px-7">
              {questions.map((item) => (
                <details key={item.question} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center gap-4 font-medium marker:hidden">
                    <span className="flex-1">{item.question}</span>
                    <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="max-w-2xl pt-3 pr-8 text-sm leading-relaxed text-muted-foreground">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </Reveal>
        </section>

        <BeamDivider />

        {/* --------------------------------------------------- final cta */}
        <section className="py-20 pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))] lg:py-28">
          <Reveal>
            <div className="relative mx-auto flex max-w-6xl flex-col items-center overflow-hidden rounded-3xl bg-primary px-6 py-16 text-center text-primary-foreground sm:px-12 sm:py-20">
              {/* Grain keeps a large flat fill from banding on wide gamuts. */}
              <NoiseTexture noiseOpacity={0.35} className="opacity-30" />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(255,255,255,.18),transparent_32%),radial-gradient(circle_at_85%_85%,rgba(255,255,255,.12),transparent_34%)]" />
              <SparklesIcon className="relative size-7" />
              <h2 className="relative mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {t(
                  "Your next result should answer a question, not create one."
                )}
              </h2>
              <p className="relative mt-4 max-w-xl text-sm leading-relaxed text-primary-foreground/75 sm:text-base">
                {t(
                  "Create your year, enter the grades you already have, and see where you really stand."
                )}
              </p>
              <Button
                variant="secondary"
                size="lg"
                className="relative mt-8"
                render={<Link href="/auth/sign-up" />}
              >
                {t("Create my free account")}
                <ArrowRightIcon className="size-4" />
              </Button>
            </div>
          </Reveal>
        </section>
      </main>

      <LandingFooter />
    </div>
  )
}

function ComparisonRow({
  body,
  icon,
  title,
}: {
  body: string
  icon: ReactNode
  title: string
}) {
  return (
    <article className="flex gap-4 rounded-2xl border bg-card p-5 shadow-sm">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary [&_svg]:size-5">
        {icon}
      </span>
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
    </article>
  )
}

function Principle({
  body,
  delay = 0,
  icon,
  index = 0,
  link,
  title,
}: {
  body: string
  delay?: number
  icon: ReactNode
  index?: number
  link?: { href: string; label: string }
  title: string
}) {
  return (
    <PrincipleCard delay={delay} index={index}>
      <span className="grid size-9 place-items-center rounded-lg border bg-muted/60 [&_svg]:size-4">
        {icon}
      </span>
      <h3 className="font-semibold tracking-tight">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
      {link ? (
        <Link
          href={link.href}
          className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-medium underline-offset-4 hover:underline"
        >
          {link.label}
          <ArrowRightIcon className="size-3.5" />
        </Link>
      ) : null}
    </PrincipleCard>
  )
}

function Step({
  body,
  delay = 0,
  number,
  title,
}: {
  body: string
  delay?: number
  number: string
  title: string
}) {
  return (
    <Reveal delay={delay}>
      <li className="relative border-t pt-6">
        <span className="numeric font-mono text-xs font-semibold tracking-[0.2em] text-primary">
          {number}
        </span>
        <h3 className="mt-3 text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      </li>
    </Reveal>
  )
}

function LandingFooter() {
  const t = useExtracted()
  const year = new Date().getFullYear()

  const columns = [
    {
      title: t("Product"),
      links: [
        { label: t("Features"), href: "#features" },
        { label: t("How it works"), href: "#how" },
        { label: t("FAQ"), href: "#faq" },
      ],
    },
    {
      title: t("Account"),
      links: [
        { label: t("Sign in"), href: "/auth/sign-in" },
        { label: t("Create an account"), href: "/auth/sign-up" },
      ],
    },
    {
      title: t("Legal"),
      links: [
        { label: t("Privacy"), href: "/legal/privacy" },
        { label: t("Terms"), href: "/legal/terms" },
        { label: t("Social sharing"), href: "/legal/social-sharing" },
      ],
    },
  ]

  return (
    <footer className="border-t bg-muted/25">
      <div className="mx-auto max-w-6xl py-14 pr-[max(1rem,var(--spacing-safe-right))] pl-[max(1rem,var(--spacing-safe-left))] sm:pr-[max(1.5rem,var(--spacing-safe-right))] sm:pl-[max(1.5rem,var(--spacing-safe-left))]">
        <div className="flex flex-col justify-between gap-12 md:flex-row">
          <div className="max-w-xs">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 font-semibold tracking-tight"
            >
              <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <GraduationCapIcon className="size-4.5" />
              </span>
              Avermate
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {t(
                "Track grades with your school's real weighting, understand every change in your average, and build a plan toward your goals."
              )}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {columns.map((column) => (
              <nav key={column.title} aria-label={column.title}>
                <h3 className="font-mono text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                  {column.title}
                </h3>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.href.startsWith("#") ? (
                        <a
                          href={link.href}
                          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <p className="mt-12 border-t pt-6 text-xs text-muted-foreground">
          © {year} Avermate
        </p>
      </div>
    </footer>
  )
}
