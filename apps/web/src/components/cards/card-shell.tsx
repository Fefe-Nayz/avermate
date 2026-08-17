"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useScrollPane } from "@/components/shell/scroll-pane"
import { cn } from "@/lib/utils"
import { cardAccent } from "./card-accent"

/**
 * The chrome of a dashboard card, in one place.
 *
 * There were three copies of it — the grid draws the real card, and the two
 * editors each drew their own preview — and they had drifted apart in every way
 * that shows:
 *
 * - The legacy preview's body had no `min-h-0 flex-1`, so it took its natural
 *   height instead of the row's. A chart in the preview was a different size
 *   from the same chart on the dashboard, which is the loudest half of "the
 *   preview looks nothing like the card".
 * - The widget preview carried a `min-h-36` floor the real card does not have,
 *   and rendered no `cardSurface`, so it lost the loading, empty and error
 *   states entirely.
 * - Both previews wrapped their title differently: no `min-w-0`, no
 *   `break-words`, and in one case no `line-clamp-2` — so a long title broke in
 *   three different places depending on which screen you were looking at.
 *
 * None of that was a decision. Each was a copy that stopped being updated when
 * the real card was, and a preview whose whole job is to predict the card is the
 * one component that cannot afford to guess. One shell, three callers.
 *
 * Sharing the chrome was only half of it: a card is also its width, because the
 * body scales its type and its charts to `@container/card`. That half belongs to
 * whoever sizes the row — see `CardShellGrid`.
 */
export function CardShell({
  title,
  accent,
  surface,
  spanClasses,
  action,
  className,
  children,
  ...rest
}: {
  title: ReactNode
  /** Stored accent name; resolved here so every caller resolves it the same. */
  accent: string | null
  /** State styling from `cardSurface`, or `undefined` for none. */
  surface?: string
  spanClasses?: string
  /** The header's second column: controls, on the surfaces that have them. */
  action?: ReactNode
  className?: string
  children: ReactNode
} & Omit<React.ComponentProps<typeof Card>, "children" | "className">) {
  const bar = cardAccent(accent)

  return (
    <Card
      className={cn(
        // Its own query container: the body scales its type to the width the
        // grid actually gave this card, not to the viewport.
        "@container/card relative gap-2 overflow-hidden py-4",
        surface,
        spanClasses,
        className
      )}
      {...rest}
    >
      {bar ? (
        <span
          aria-hidden
          className={cn("absolute inset-x-0 top-0 h-0.5", bar.bar)}
        />
      ) : null}
      {/* CardHeader is a grid, and its action is the second column: the title
          gets the `1fr` and the controls the `auto`, so the two never bargain
          for the same pixels. Laying them out as loose flex siblings is what
          let a long title be squeezed mid-word on the narrowest column, and
          left the handle sitting on a different baseline from the buttons. */}
      <CardHeader className="px-4">
        <CardTitle
          className={cn(
            // Two lines rather than an ellipsis: at the narrowest column
            // "Strongest subject" does not fit on one, and a card whose own
            // title is cut off has stopped saying what it is. `break-words`
            // covers the case the column is narrower than the longest word.
            "line-clamp-2 min-w-0 text-xs leading-tight font-medium tracking-wide break-words uppercase",
            bar ? bar.text : "text-muted-foreground"
          )}
        >
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      {/* The row's height is set by its tallest card; `flex-1` hands the
          difference to the body so charts can drink it. Bodies that keep
          their natural height simply leave it. */}
      <CardContent className="min-h-0 flex-1 px-4">{children}</CardContent>
    </Card>
  )
}

/** `gap-3`, as a number, because the track arithmetic below needs it. */
const GRID_GAP = 12

/**
 * The dashboard's grid, measured rather than guessed.
 *
 * The grid gains a column through container queries on the pane —
 * `@2xl/main` at 42rem and `@4xl/main` at 56rem — so the *pane* decides, not the
 * window. The editor used to decide with `useMediaQuery("(min-width: 1200px)")`
 * and `900px` against the viewport, and its own comment called that "room left
 * for the sidebar the dashboard has and this page's column does not". It is an
 * approximation, and it is wrong in bands rather than by a little: at a 940px
 * window with a sidebar the pane is about 660px, so the editor drew three
 * columns for a dashboard that draws two. The card was then previewed at a width
 * and a span the dashboard never gives it.
 *
 * Both numbers now come from one measurement of the pane, so the count and the
 * track width cannot disagree with each other either.
 */
export function useDashboardGrid(): { columns: number; track: number | null } {
  const pane = useScrollPane()
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = pane?.ref.current
    if (!node) return
    const measure = () => setWidth(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [pane])

  // The same two thresholds the grid's container queries use, in pixels at the
  // root font size. Read here so the editor steps where the dashboard steps.
  const columns = width >= 896 ? 4 : width >= 672 ? 3 : 2

  return {
    columns,
    // The page's own horizontal padding makes this a few pixels generous per
    // column — against the threefold error it replaces.
    track: width > 0 ? (width - (columns - 1) * GRID_GAP) / columns : null,
  }
}

/**
 * The row a preview card sits in, at the dashboard's own *width* — not just its
 * proportions.
 *
 * This used to divide whatever box it was given into `columns` fractions, which
 * is right about the share of a row the card takes and wrong about every pixel.
 * The editor's preview sits in an aside of `minmax(20rem, 0.7fr)`: measured at a
 * 1280px viewport, a quarter-width card came out **107px** here against **311px**
 * on the dashboard. The body scales its type and its charts to
 * `@container/card`, so at a third of the width nothing inside the card
 * matched — the preview and the card it was predicting had, accurately, nothing
 * to do with each other.
 *
 * So the tracks are sized from the pane the dashboard will actually be drawn in
 * rather than from the box this preview happens to occupy, and the row is
 * allowed to overrun that box and scroll. A card narrower than the aside — a
 * quarter or a half on a wide screen — is then exact *and* fully visible. A
 * full-width card cannot be both: 1280px of card will not fit in 464px of aside
 * however it is arranged, so it stays exact and scrolls, which is the same
 * answer this codebase gives every other over-wide thing. Scaling it down
 * instead would keep it whole and make its type unreadable at 0.34.
 *
 * Before the pane is measured, and outside the shell entirely, it falls back to
 * fractions of its own box — the old behaviour, which is wrong about width but
 * never broken.
 */
export function CardShellGrid({ children }: { children: ReactNode }) {
  const { columns, track } = useDashboardGrid()

  return (
    // Its own scroller, so a row wider than the aside never widens the page.
    <div className="overflow-x-auto">
      <div
        className={cn(
          // `w-max` so the grid's own box is as wide as its tracks. Left to
          // `auto` it is clamped to the scroller and its items paint outside it,
          // which puts the card's own edges past the box that owns them.
          "grid gap-3",
          track !== null && "w-max",
          track === null &&
            (columns === 4
              ? "grid-cols-4"
              : columns === 3
                ? "grid-cols-3"
                : "grid-cols-2")
        )}
        style={
          track === null
            ? undefined
            : { gridTemplateColumns: `repeat(${columns}, ${track}px)` }
        }
      >
        {children}
      </div>
    </div>
  )
}
