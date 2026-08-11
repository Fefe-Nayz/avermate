import type { Metadata } from "next"
import Link from "next/link"
import { Suspense, type ReactNode } from "react"
import {
  ArrowRightIcon,
  BookOpenCheckIcon,
  BrainCircuitIcon,
  ChartNoAxesCombinedIcon,
  CheckIcon,
  ChevronDownIcon,
  Clock3Icon,
  GraduationCapIcon,
  Layers3Icon,
  LayoutDashboardIcon,
  LockKeyholeIcon,
  RouteIcon,
  SmartphoneIcon,
  SparklesIcon,
  TargetIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { LandingPreview } from "@/components/landing/landing-preview"
import { LandingStats } from "@/components/landing/landing-stats"
import { PublicThemeToggle } from "@/components/theme/public-theme-toggle"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Avermate — Understand every grade",
  description:
    "Track grades with your school's real weighting, understand every change in your average, and build a plan toward your goals.",
}

export default function LandingPage() {
  const t = useExtracted()

  const features = [
    {
      icon: Layers3Icon,
      title: t("Weighting that matches your school"),
      body: t(
        "Build subjects, categories and sub-subjects as deeply as you need. Every coefficient stays visible and editable."
      ),
    },
    {
      icon: TargetIcon,
      title: t("Goals that turn into a plan"),
      body: t(
        "Choose a target and see the next result it requires, the subject where effort pays most, and whether it is still reachable."
      ),
    },
    {
      icon: BrainCircuitIcon,
      title: t("Insights, not decoration"),
      body: t(
        "Read impact, consistency, progression, distribution and projection without having to rebuild the maths in a spreadsheet."
      ),
    },
    {
      icon: LayoutDashboardIcon,
      title: t("A dashboard that is actually yours"),
      body: t(
        "Pick the metrics that matter, choose how much room they get, and reorder them around the way you follow your year."
      ),
    },
    {
      icon: Clock3Icon,
      title: t("Go back to any day"),
      body: t(
        "Time travel hides later results across the whole app, so you can understand exactly where you stood before an assessment."
      ),
    },
    {
      icon: SparklesIcon,
      title: t("A year worth remembering"),
      body: t(
        "Your recap turns the year into a shareable story: activity, strongest subjects, best run, progression and your own title."
      ),
    },
  ]

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
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t("Skip to content")}
      </a>

      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/82 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link
            href="/"
            aria-label={t("Avermate home")}
            className="flex items-center gap-2.5 font-semibold tracking-tight"
          >
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <GraduationCapIcon className="size-4.5" />
            </span>
            Avermate
          </Link>

          <nav
            aria-label={t("Landing page")}
            className="ml-8 hidden items-center gap-1 xl:flex"
          >
            <HeaderLink href="#why">{t("Why Avermate")}</HeaderLink>
            <HeaderLink href="#features">{t("Features")}</HeaderLink>
            <HeaderLink href="#how">{t("How it works")}</HeaderLink>
            <HeaderLink href="#faq">{t("FAQ")}</HeaderLink>
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <PublicThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              render={<Link href="/auth/sign-in" />}
            >
              {t("Sign in")}
            </Button>
            <Button size="sm" render={<Link href="/auth/sign-up" />}>
              <span className="hidden sm:inline">{t("Get started")}</span>
              <span className="sm:hidden">{t("Join")}</span>
            </Button>
          </div>
        </div>
      </header>

      <main id="content">
        <section className="relative isolate">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[48rem] overflow-hidden">
            <div className="absolute top-[-18rem] left-1/2 size-[48rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
            <div className="absolute top-16 left-[12%] size-72 rounded-full bg-chart-2/10 blur-3xl" />
            <div className="absolute top-24 right-[8%] size-80 rounded-full bg-chart-3/10 blur-3xl" />
          </div>

          <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pt-16 text-center sm:px-6 sm:pt-24">
            <span className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
              <SparklesIcon className="size-3.5 text-primary" />
              {t("Your grades finally explain themselves")}
            </span>
            <h1 className="mt-7 max-w-4xl text-4xl leading-[1.05] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-7xl">
              {t("Know where you stand — and what to do next.")}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
              {t(
                "Avermate follows your school's real weighting, explains every movement in your average, and turns the result you want into a practical plan."
              )}
            </p>
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
            <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <TrustItem>{t("Free to use")}</TrustItem>
              <TrustItem>{t("No credit card")}</TrustItem>
              <TrustItem>{t("Your data stays yours")}</TrustItem>
            </div>

            <Suspense fallback={null}>
              <LandingStats />
            </Suspense>
          </div>

          <div
            id="preview"
            className="mx-auto mt-12 max-w-6xl scroll-mt-24 px-2 pb-20 sm:mt-16 sm:px-6"
          >
            <div className="relative rounded-[1.75rem] border bg-card/60 p-2 shadow-[0_32px_100px_-42px_rgba(0,0,0,.45)] backdrop-blur sm:p-3">
              <div className="flex items-center gap-1.5 border-b px-3 py-2.5">
                <span className="size-2.5 rounded-full bg-destructive/70" />
                <span className="size-2.5 rounded-full bg-band-fair/80" />
                <span className="size-2.5 rounded-full bg-band-excellent/75" />
                <span className="mx-auto -translate-x-4 rounded-md bg-muted px-12 py-1 text-[10px] text-muted-foreground">
                  avermate.fr
                </span>
              </div>
              <div className="overflow-hidden rounded-b-[1.25rem]">
                <LandingPreview />
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              {t(
                "A worked example powered by Avermate's real calculation engine — not a picture of one."
              )}
            </p>
          </div>
        </section>

        <section
          id="why"
          aria-labelledby="why-title"
          className="scroll-mt-20 border-y bg-muted/35"
        >
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-28">
            <div>
              <Eyebrow>{t("More than a calculator")}</Eyebrow>
              <h2
                id="why-title"
                className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
              >
                {t("A number is useful. Understanding it is better.")}
              </h2>
              <p className="mt-5 max-w-xl leading-relaxed text-muted-foreground">
                {t(
                  "A spreadsheet can produce an average. Avermate keeps the structure behind it, shows what changed it, and helps you decide where your next hour matters most."
                )}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
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
          </div>
        </section>

        <section
          id="features"
          aria-labelledby="features-title"
          className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 lg:py-28"
        >
          <div className="max-w-2xl">
            <Eyebrow>{t("Built around a whole school year")}</Eyebrow>
            <h2
              id="features-title"
              className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
            >
              {t("The detail when you need it. The answer when you do not.")}
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <article
                key={feature.title}
                className="group rounded-2xl border bg-card p-6 shadow-sm transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/8 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <feature.icon className="size-5" />
                </span>
                <h3 className="mt-5 font-semibold tracking-tight">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {feature.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="how"
          aria-labelledby="how-title"
          className="scroll-mt-20 border-y bg-card"
        >
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
            <div className="text-center">
              <Eyebrow>{t("From blank page to useful answer")}</Eyebrow>
              <h2
                id="how-title"
                className="mx-auto mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
              >
                {t("Set up once. Learn from every result after that.")}
              </h2>
            </div>
            <ol className="mt-12 grid gap-8 md:grid-cols-3">
              <Step
                number="01"
                title={t("Describe your year")}
                body={t(
                  "Start from a school template or create your own subjects, periods, scale and coefficients."
                )}
              />
              <Step
                number="02"
                title={t("Record results")}
                body={t(
                  "Add a simple or composite grade. Avermate files it into the right period and updates every related view."
                )}
              />
              <Step
                number="03"
                title={t("Act on the answer")}
                body={t(
                  "Review impact and trends, then set a target to see the most useful next move."
                )}
              />
            </ol>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-5 px-4 py-20 sm:px-6 md:grid-cols-2 lg:py-28">
          <article className="relative overflow-hidden rounded-3xl border bg-[linear-gradient(145deg,color-mix(in_oklab,var(--primary)_10%,var(--card)),var(--card))] p-7 sm:p-9">
            <SmartphoneIcon className="size-7 text-primary" />
            <h2 className="mt-5 text-2xl font-semibold tracking-tight">
              {t("One engine, from desktop to phone")}
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              {t(
                "The web and mobile apps share the same calculation model and account data. A quick grade entry and a deep analysis never have to live in separate tools."
              )}
            </p>
          </article>
          <article className="relative overflow-hidden rounded-3xl border bg-[linear-gradient(145deg,color-mix(in_oklab,var(--chart-2)_10%,var(--card)),var(--card))] p-7 sm:p-9">
            <LockKeyholeIcon className="size-7 text-primary" />
            <h2 className="mt-5 text-2xl font-semibold tracking-tight">
              {t("School data stays personal")}
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              {t(
                "Private account data is prepared securely for your session. You can review sessions, export what you entered, clear it, or delete the account."
              )}
            </p>
            <Link
              href="/legal/privacy"
              className="mt-5 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
            >
              {t("Read the privacy policy")}
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </article>
        </section>

        <section
          id="faq"
          aria-labelledby="faq-title"
          className="mx-auto max-w-4xl scroll-mt-20 px-4 pb-20 sm:px-6 lg:pb-28"
        >
          <div className="text-center">
            <Eyebrow>{t("Questions, answered")}</Eyebrow>
            <h2
              id="faq-title"
              className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              {t("Before you add your first grade")}
            </h2>
          </div>
          <div className="mt-10 divide-y rounded-2xl border bg-card px-5 sm:px-7">
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
        </section>

        <section className="px-4 pb-20 sm:px-6 lg:pb-28">
          <div className="relative mx-auto flex max-w-6xl flex-col items-center overflow-hidden rounded-3xl bg-primary px-6 py-16 text-center text-primary-foreground sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(255,255,255,.18),transparent_32%),radial-gradient(circle_at_85%_85%,rgba(255,255,255,.12),transparent_34%)]" />
            <SparklesIcon className="relative size-7" />
            <h2 className="relative mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {t("Your next result should answer a question, not create one.")}
            </h2>
            <p className="relative mt-4 max-w-xl text-sm leading-relaxed text-primary-foreground/70 sm:text-base">
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
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCapIcon className="size-3.5" />
            </span>
            Avermate
          </div>
          <p>© {new Date().getFullYear()} Avermate</p>
          <nav
            aria-label={t("Legal")}
            className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-auto"
          >
            <Link href="/auth/sign-in" className="hover:text-foreground">
              {t("Sign in")}
            </Link>
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
  )
}

function HeaderLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </Link>
  )
}

function TrustItem({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <CheckIcon className="size-3.5 text-positive" />
      {children}
    </span>
  )
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
      {children}
    </p>
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
    <article className="flex gap-4 rounded-2xl border bg-background p-5 shadow-sm">
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

function Step({
  body,
  number,
  title,
}: {
  body: string
  number: string
  title: string
}) {
  return (
    <li className="relative border-t pt-6">
      <span className="numeric text-xs font-semibold tracking-[0.2em] text-primary">
        {number}
      </span>
      <h3 className="mt-3 text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </li>
  )
}
