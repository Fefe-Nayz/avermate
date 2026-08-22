"use client"

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  widgetCapability,
  widgetMeasureId,
  widgetPrimaryMeasure,
  widgetRecipeLayout,
} from "@avermate/core"
import { CardShell, cardSurface } from "./card-shell"
import { WidgetBody } from "./widget-view"
import { useWidgetResult } from "./use-widget-result"
import {
  cardMatrix,
  cardMatrixEmpty,
  cardMatrixSample,
  cardMatrixVariants,
  type MatrixCard,
  type MatrixOptions,
} from "./card-matrix"
import { CARD_ACCENTS } from "./card-accent"
import { useYear } from "@/components/year/year-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The card test bench.
 *
 * Two things are being looked for here, and they need different arrangements.
 * Whether a *body* renders is answered by the full matrix at one span — seventy
 * cards, one per measure/grouping/mark the registry allows. Whether it renders
 * *well* is answered by the same handful of bodies put through widths, spans and
 * row heights they would otherwise only meet on someone else's screen: a card is
 * as tall as the tallest card in its row and as wide as its span of a pane whose
 * column count is itself a container query, so "it looks right" on one dashboard
 * says very little about the next.
 *
 * The data is the account's own, so a card with nothing to say says so. That is
 * the point: "Not enough data yet" is a state with a layout too.
 */

/** How a span clamps as the grid loses columns — the packer's rule, in classes. */
const SPAN_CLASSES: Record<MatrixCard["span"], string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-2 @2xl/main:col-span-3",
  4: "col-span-2 @2xl/main:col-span-3 @4xl/main:col-span-4",
}

/** The dashboard's own grid, so the columns step where the dashboard's step. */
const DASHBOARD_GRID =
  "grid grid-cols-2 gap-3 @2xl/main:grid-cols-3 @4xl/main:grid-cols-4"

function PreviewCard({
  card,
  className,
}: {
  card: MatrixCard
  className?: string
}) {
  const result = useWidgetResult(card.definition, card.surface)
  const measure = widgetCapability(
    widgetMeasureId(widgetPrimaryMeasure(card.definition.analysis))
  )

  return (
    <CardShell
      title={card.title}
      accent={card.accent}
      surface={cardSurface(result)}
      spanClasses={cn(SPAN_CLASSES[card.span], className)}
      heightTier={
        widgetRecipeLayout(card.definition.visualization.recipe).minHeightTier
      }
      data-card={card.key}
      data-shape={measure.resultShape}
    >
      <WidgetBody
        definition={card.definition}
        result={result}
        expanded={card.expanded}
      />
    </CardShell>
  )
}

/**
 * One section renders at a time, and that is not a nicety.
 *
 * The whole bench is upwards of five hundred cards and two hundred charts, each
 * of which measures its own box before it draws. Rendered together they mount for
 * minutes and the page cannot be judged — which defeats the point of a bench. A
 * section is the unit anyone actually reviews, so a section is the unit that
 * renders.
 */
const SectionContext = createContext<string | null>(null)

function Section({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: ReactNode
}) {
  const active = useContext(SectionContext)
  const open = active === null || active === title
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{note}</p>
      </header>
      {open ? (
        children
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Not rendered — pick this section above.
        </p>
      )}
    </section>
  )
}

/** A pane of a fixed width, so the grid's own container queries are exercised. */
function Pane({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-xs text-muted-foreground">{width}px</p>
      {/* Its own `@container/main`, which is what the grid measures. The outer
          scroller keeps a pane wider than the page from widening the page. */}
      <div className="max-w-full overflow-x-auto">
        <div className="@container/main" style={{ width }}>
          <div className={DASHBOARD_GRID}>{children}</div>
        </div>
      </div>
    </div>
  )
}

/** Widths that put the grid on each side of both of its column steps. */
const PANE_WIDTHS = [320, 420, 560, 680, 720, 900, 1120]

const LONG_TITLE =
  "A deliberately long card title that no column is wide enough to hold on one line"

/** Every section title, in page order. Kept beside the sections themselves. */
const SECTION_TITLES = [
  "Every card, at the dashboard's own width",
  "Every option that changes what you see",
  "The insights rendering of the same cards",
  "Every card, as insights draws it",
  "Rows that mix a tall body with short ones",
  "The same cards, pane by pane",
  "Spans crossed with widths",
  "Spans, one body at a time",
  "A single card, alone in its row",
  "Accents",
  "Titles longer than any column",
  "Nothing to draw",
  "A tall row",
] as const

export function CardMatrixBench() {
  const { goals, years, year, subjects, periods } = useYear()
  const [span, setSpan] = useState<MatrixCard["span"]>(1)
  const [section, setSection] = useState<string | null>(SECTION_TITLES[0])

  // The variants that name a goal, a period or a subject name the account's own,
  // so what the page draws is a card it could actually have.
  const references = useMemo<MatrixOptions>(
    () => ({
      goalId: goals[0]?.id ?? null,
      periodId: periods[0]?.id ?? null,
      subjectIds: subjects.map((subject) => subject.id),
    }),
    [goals, periods, subjects]
  )
  const goalId = references.goalId

  const matrix = useMemo(() => cardMatrix(span, references), [references, span])
  const insightsMatrix = useMemo(
    () => cardMatrix(span, { ...references, surface: "insights" }),
    [references, span]
  )
  const variants = useMemo(
    () => cardMatrixVariants(1, references),
    [references]
  )
  const insightsSample = useMemo(
    () => cardMatrixSample(2, { ...references, surface: "insights" }),
    [references]
  )
  const sample = useMemo(() => cardMatrixSample(1, references), [references])

  /** The pairing that produced the bug this page was built for. */
  const mixedRows = useMemo(() => {
    const tall = cardMatrixSample(2, { goalId }).filter((card) =>
      ["heatmap", "table", "boxplot"].some((mark) => card.key.endsWith(mark))
    )
    const short = cardMatrixSample(1, { goalId }).filter((card) =>
      ["value", "gauge"].some((mark) => card.key.endsWith(mark))
    )
    return tall.flatMap((card, index) => [
      card,
      ...short.slice(index * 2, index * 2 + 2),
    ])
  }, [goalId])

  const accented = useMemo(
    () =>
      CARD_ACCENTS.map((accent, index) => ({
        ...sample[index % sample.length]!,
        key: `accent:${accent.value}`,
        title: `accent · ${accent.value}`,
        accent: accent.value,
      })),
    [sample]
  )

  const empties = useMemo(() => cardMatrixEmpty(1, { goalId }), [goalId])

  const stressed = useMemo<MatrixCard[]>(
    () => [
      { ...sample[0]!, key: "stress:long-title", title: LONG_TITLE },
      {
        ...sample[2]!,
        key: "stress:long-title-record",
        title: LONG_TITLE,
      },
      {
        ...sample[8]!,
        key: "stress:long-title-list",
        title: LONG_TITLE,
        span: 2,
      },
    ],
    [sample]
  )

  return (
    <SectionContext.Provider value={section}>
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-8 p-4 pb-24">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Card matrix</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            {matrix.length} generated cards — every measure, grouping and mark
            the registry allows — drawn against {year ? year.name : "no year"} (
            {years.length} year
            {years.length === 1 ? "" : "s"}, {goals.length} goal
            {goals.length === 1 ? "" : "s"}). Development only.
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-full text-sm text-muted-foreground">
              Section — one at a time, because two hundred charts do not mount
              together
            </span>
            {SECTION_TITLES.map((title) => (
              <Button
                key={title}
                size="sm"
                variant={section === title ? "default" : "outline"}
                onClick={() => setSection(title)}
              >
                {title}
              </Button>
            ))}
            <Button
              size="sm"
              variant={section === null ? "default" : "outline"}
              onClick={() => setSection(null)}
            >
              Everything (slow)
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Matrix span</span>
            {([1, 2, 3, 4] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={span === value ? "default" : "outline"}
                onClick={() => setSpan(value)}
              >
                {value}
              </Button>
            ))}
          </div>
        </header>

        <Section
          title="Every card, at the dashboard's own width"
          note="The pane is the real one, so this is the arrangement an account
          actually gets. Switch the span above to see each body at a quarter, a
          half and the full width of the grid."
        >
          <div className={DASHBOARD_GRID}>
            {matrix.map((card) => (
              <PreviewCard key={card.key} card={card} />
            ))}
          </div>
        </Section>

        <Section
          title="Every option that changes what you see"
          note="The mark is only part of a card's look. A line with its axes
          turned off is the dashboard's own sparkline; a gauge without its number
          is a bar; a threshold recolours the figure and writes a line under it.
          These are the variants a matrix of defaults would miss."
        >
          <div className={DASHBOARD_GRID}>
            {variants.map((card) => (
              <PreviewCard key={card.key} card={card} />
            ))}
          </div>
        </Section>

        <Section
          title="The insights rendering of the same cards"
          note="A dashboard card is a glance and an insights card is a study, so
          the same definition draws a different body: a ranking becomes a plain
          series list, a series becomes a full chart instead of a reading over a
          sparkline, a histogram gets its axes. Three of the renderer's ten
          bodies exist only here."
        >
          <div className={DASHBOARD_GRID}>
            {insightsSample.map((card) => (
              <PreviewCard key={card.key} card={card} />
            ))}
          </div>
        </Section>

        <Section
          title="Every card, as insights draws it"
          note="The same walk over the registry, expanded. Follows the span
          chosen above."
        >
          <div className={DASHBOARD_GRID}>
            {insightsMatrix.map((card) => (
              <PreviewCard key={card.key} card={card} />
            ))}
          </div>
        </Section>

        <Section
          title="Rows that mix a tall body with short ones"
          note="A row is as tall as its tallest card, so this is where a body that
          stacks its lines at the top leaves the rest of the card empty. Every
          short card here should reach the bottom of its row."
        >
          <div className={DASHBOARD_GRID}>
            {mixedRows.map((card, index) => (
              <PreviewCard key={`${card.key}:${index}`} card={card} />
            ))}
          </div>
        </Section>

        <Section
          title="The same cards, pane by pane"
          note="The grid gains a column at 42rem and another at 56rem, and each
          card scales its own type to the width it ends up with. These widths sit
          on both sides of both steps."
        >
          <div className="flex flex-col gap-6">
            {PANE_WIDTHS.map((width) => (
              <Pane key={width} width={width}>
                {sample.map((card) => (
                  <PreviewCard key={card.key} card={card} />
                ))}
              </Pane>
            ))}
          </div>
        </Section>

        <Section
          title="Spans crossed with widths"
          note="A span is a share of a grid whose column count is itself a
          container query, so the same span is a different card in a different
          pane: two of two columns fills the row, two of four is half of it.
          Every span, in every pane."
        >
          <div className="flex flex-col gap-6">
            {PANE_WIDTHS.map((width) => (
              <Pane key={width} width={width}>
                {([1, 2, 3, 4] as const).map((value) => (
                  <PreviewCard
                    key={value}
                    card={{
                      ...sample[0]!,
                      key: `${width}:${value}`,
                      span: value,
                      title: `span ${value}`,
                    }}
                  />
                ))}
                {([1, 2, 3, 4] as const).map((value) => (
                  <PreviewCard
                    key={`list:${value}`}
                    card={{
                      ...sample[8]!,
                      key: `${width}:list:${value}`,
                      span: value,
                      title: `ranking · span ${value}`,
                    }}
                  />
                ))}
              </Pane>
            ))}
          </div>
        </Section>

        <Section
          title="Spans, one body at a time"
          note="Each row holds the same card at spans one to four, so a body that
          only works at one width shows it here."
        >
          <div className="flex flex-col gap-3">
            {sample.map((card) => (
              <div key={card.key} className={DASHBOARD_GRID}>
                {([1, 2, 3, 4] as const).map((value) => (
                  <PreviewCard
                    key={value}
                    card={{
                      ...card,
                      span: value,
                      title: `${card.title} · ${value}`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="A single card, alone in its row"
          note="Nothing sets the row's height but the card itself, so this is each
          body at its natural size — the floor a body must look right at."
        >
          <div className="flex flex-col gap-3">
            {sample.map((card) => (
              <div key={card.key} className={DASHBOARD_GRID}>
                <PreviewCard card={{ ...card, span: 4 }} />
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Accents"
          note="The stored accent colours the rule above the card and its title.
          Every accent, on rotating bodies."
        >
          <div className={DASHBOARD_GRID}>
            {accented.map((card) => (
              <PreviewCard key={card.key} card={card} />
            ))}
          </div>
        </Section>

        <Section
          title="Titles longer than any column"
          note="A card whose own title is cut off has stopped saying what it is,
          so a long title wraps to two lines and then clamps — never an ellipsis
          mid-word."
        >
          <div className={DASHBOARD_GRID}>
            {stressed.map((card) => (
              <PreviewCard key={card.key} card={card} />
            ))}
          </div>
        </Section>

        <Section
          title="Nothing to draw"
          note="A window with no grades in it. Every body has an empty state, and
          a new account meets all of them at once."
        >
          <div className={DASHBOARD_GRID}>
            {empties.map((card) => (
              <PreviewCard key={card.key} card={card} />
            ))}
          </div>
        </Section>

        <Section
          title="A tall row"
          note="Given far more height than any body needs, a card should spend it
          or centre in it — never leave it stacked at the top."
        >
          <div className={DASHBOARD_GRID}>
            {sample.slice(0, 8).map((card) => (
              <PreviewCard key={card.key} card={card} className="min-h-80" />
            ))}
          </div>
        </Section>
      </div>
    </SectionContext.Provider>
  )
}
