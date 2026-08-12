"use client"

import { useRouter } from "next/navigation"
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  PencilIcon,
  XIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PageMeta } from "@/components/shell/page-chrome"
import { useKeyboardInset } from "@/hooks/use-keyboard-inset"
import { useMediaQuery } from "@/hooks/use-media-query"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/**
 * One decision, and how to show it.
 *
 * `content` is the same on both surfaces — the fields do not change shape, only
 * how many of them are on screen at once. `summary` is what the phone's review
 * screen reads back, and is the reason the review is worth having: a list of
 * answers you can check is not the same as scrolling the form again.
 */
export interface FlowStep {
  id: string
  title: string
  description?: string
  content: ReactNode
  /** Read back on the review screen. Omit for a step with nothing to report. */
  summary?: ReactNode
  /**
   * Runs before the phone leaves this step. Return false to stay put — the
   * caller is expected to have surfaced the reason in its own fields.
   */
  validate?: () => boolean
  /** A step that does not apply yet. Hidden, not disabled. */
  when?: boolean
}

/**
 * The shell every form screen uses.
 *
 * Forms are screens, not dialogs: a dialog on a phone fights the keyboard,
 * traps scrolling, loses its content to a stray swipe, and cannot be linked to
 * or navigated back out of.
 *
 * The two surfaces then diverge, because they are not the same problem. A
 * laptop has room for the whole form at once and a mouse that can move between
 * fields freely, so it gets exactly that: every step stacked, one save. A phone
 * has room for one decision, so it gets one decision at a time, a progress
 * indicator so the end is visible from the start, a review screen that reads
 * the answers back and lets any of them be changed, and the primary action
 * pinned where a thumb reaches it and the keyboard cannot cover it.
 *
 * Both drive the identical state, so nothing about the data depends on which
 * surface filled it in.
 */
export function FormFlow({
  title,
  description,
  backHref,
  steps,
  onSubmit,
  submitLabel,
  submitting = false,
  disabled = false,
  destructive,
  footerNote,
  /** Shown above the first step on both surfaces, e.g. a live preview. */
  aside,
  /**
   * The last optional touches — a note, a title — asked for on the review
   * screen rather than as a step of their own. Nobody wants a whole screen
   * for a field they will usually skip, and on the confirmation it is right
   * where "anything else before I save?" belongs. Desktop gets it as a final
   * section, since desktop has no review.
   */
  beforeSave,
  overlays,
}: {
  title: string
  description?: string
  backHref?: string
  steps: FlowStep[]
  onSubmit: () => void
  submitLabel: string
  submitting?: boolean
  disabled?: boolean
  destructive?: { label: string; onClick: () => void }
  footerNote?: ReactNode
  aside?: ReactNode
  beforeSave?: ReactNode
  /** Dialogs and layers that belong to the form but to no single step. */
  overlays?: ReactNode
}) {
  const t = useExtracted()
  const router = useRouter()
  const keyboard = useKeyboardInset()
  const wide = useMediaQuery("(min-width: 768px)")
  const formRef = useRef<HTMLFormElement>(null)
  const active = useMemo(
    () => steps.filter((step) => step.when !== false),
    [steps]
  )
  const [index, setIndex] = useState(0)

  // A step can disappear under the cursor — turning off "made of several
  // parts" removes one — so the position is clamped at read time rather than
  // synchronised, which would need an effect and a render to settle.
  const reviewIndex = active.length
  const position = Math.min(index, reviewIndex)
  const onReview = position === reviewIndex
  const step = active[position]

  const submit = useCallback(() => {
    if (submitting || disabled) return
    haptic("light")
    onSubmit()
  }, [disabled, onSubmit, submitting])

  /**
   * On a phone, the review screen's button is the only thing that saves.
   *
   * A `<form>` submits for reasons that have nothing to do with intent: a
   * control inside it that forgot `type="button"`, a browser's implicit
   * submission on Enter, a third-party widget's own button. Chasing each one
   * down as it appears is how a form ends up saving halfway through a flow.
   * Refusing every submit that does not come from the last screen makes it a
   * property of the flow rather than of every button inside it.
   */
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!wide && !onReview) return
    submit()
  }

  const goto = (next: number) => {
    haptic("selection")
    setIndex(next)
    // A new step starts at its own top, not wherever the last one was read to.
    // The document does not scroll here — the shell scrolls a pane — so the
    // pane is what has to be told.
    formRef.current?.closest(".scroll-pane")?.scrollTo({ top: 0 })
  }

  /**
   * Keep whatever is focused above the keyboard.
   *
   * Browsers do this for a document that scrolls itself; inside a scroll pane
   * with a pinned action bar they routinely leave the field half-covered. One
   * frame after the viewport has settled is early enough not to be seen.
   */
  /**
   * The keyboard's own "next" key moves through the flow.
   *
   * A phone keyboard offers one action key, and inside a flow the thing it
   * should do is go on — which is also why the fields ask for "next" rather
   * than "go". On a laptop Enter keeps meaning submit, because there the whole
   * form is on screen and there is nothing to advance to.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || wide) return
    const target = event.target
    // A textarea's Enter is a newline, and a button's is a click.
    if (!(target instanceof HTMLInputElement)) return

    event.preventDefault()
    if (onReview) submit()
    else advance()
  }

  const revealFocused = (event: React.FocusEvent<HTMLFormElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (!target.matches("input, textarea, [contenteditable]")) return
    window.setTimeout(
      () => target.scrollIntoView({ block: "center", behavior: "smooth" }),
      120
    )
  }

  const advance = () => {
    if (step?.validate && !step.validate()) {
      haptic("warning")
      return
    }
    goto(position + 1)
  }

  return (
    <>
      <PageMeta title={title} subtitle={description} backHref={backHref} />

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        onFocus={revealFocused}
        onKeyDown={onKeyDown}
        className="mx-auto w-full max-w-2xl"
      >
        <div className="hidden items-start justify-between gap-4 pb-4 md:flex">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Close")}
            onClick={() => router.back()}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {aside ? <div className="pb-5">{aside}</div> : null}

        {/* Desktop: the whole form, once. */}
        <div className="hidden flex-col gap-6 md:flex">
          {active.map((item) => (
            <section key={item.id} className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-medium">{item.title}</h2>
                {item.description ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
              </div>
              {item.content}
            </section>
          ))}
          {beforeSave}
        </div>

        {/* Phone: one decision, then a read-back. */}
        <div className="flex flex-col gap-4 pb-32 md:hidden">
          <Progress
            position={position}
            total={reviewIndex + 1}
            label={
              onReview
                ? t("Review")
                : t("Step {position} of {total}", {
                    position: String(position + 1),
                    total: String(reviewIndex + 1),
                  })
            }
          />

          {onReview ? (
            <Review steps={active} onEdit={goto} extra={beforeSave} />
          ) : step ? (
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {step.title}
                </h2>
                {step.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {step.description}
                  </p>
                ) : null}
              </div>
              {step.content}
            </section>
          ) : null}
        </div>

        {footerNote ? (
          <p className="pt-4 pb-28 text-xs text-muted-foreground md:pb-0">
            {footerNote}
          </p>
        ) : null}

        {/* Above the tab bar rather than under it, and above the keyboard
            when there is one — a bar the thumb cannot reach is not pinned,
            it is hidden. The tab bar's own offset is dropped while the
            keyboard is up, because the keyboard already covers it. */}
        <div
          style={
            keyboard > 0
              ? { bottom: `${keyboard}px` }
              : {
                  bottom:
                    "calc(var(--spacing-tabbar) + var(--spacing-safe-bottom))",
                }
          }
          className={cn(
            "fixed inset-x-0 z-40 border-t border-border/70 bg-background px-4 pt-3 pb-3",
            "md:static md:mt-6 md:border-0 md:bg-transparent md:px-0 md:pt-0 md:pb-0"
          )}
        >
          {/* Phone: move through the flow, and only save from the review. */}
          <div className="flex items-center gap-2 md:hidden">
            {position > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                aria-label={t("Back")}
                onClick={() => goto(position - 1)}
              >
                <ArrowLeftIcon className="size-4" />
              </Button>
            ) : null}
            {/* Both are `type="button"`, and they carry different keys.
                Sharing a node meant that tapping "Continue" advanced the step,
                React turned that very node into a submit button, and the
                browser then ran the in-flight click's default action against
                it — saving the form from the step before the review. Nothing
                here submits: the phone saves by calling `submit` directly. */}
            {onReview ? (
              <Button
                key="save"
                type="button"
                size="lg"
                disabled={submitting || disabled}
                className="flex-1"
                onClick={submit}
              >
                {submitting ? <Spinner className="size-4" /> : null}
                {submitLabel}
              </Button>
            ) : (
              <Button
                key="continue"
                type="button"
                size="lg"
                className="flex-1"
                onClick={advance}
              >
                {t("Continue")}
                <ArrowRightIcon className="size-4" />
              </Button>
            )}
          </div>

          <div className="hidden items-center gap-2 md:flex">
            {destructive ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  haptic("warning")
                  destructive.onClick()
                }}
              >
                {destructive.label}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="ml-auto"
              onClick={() => router.back()}
            >
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={submitting || disabled} size="lg">
              {submitting ? <Spinner className="size-4" /> : null}
              {submitLabel}
            </Button>
          </div>
        </div>

        {/* A destructive action does not belong next to "Continue", where a
            thumb aiming for the primary button would find it. */}
        {destructive ? (
          <div className="flex justify-center pb-4 md:hidden">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                haptic("warning")
                destructive.onClick()
              }}
            >
              {destructive.label}
            </Button>
          </div>
        ) : null}

        {overlays}
      </form>
    </>
  )
}

/** How far in, and how far left. */
function Progress({
  position,
  total,
  label,
}: {
  position: number
  total: number
  label: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={position + 1}
        aria-label={label}
        className="flex gap-1"
      >
        {Array.from({ length: total }, (_, step) => (
          <span
            key={step}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              step <= position ? "bg-primary" : "bg-border"
            )}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * The answers, read back.
 *
 * Every line is editable, which is the point: a summary you cannot act on is a
 * screen between the user and saving, and a form whose last screen is a wall of
 * text gets skipped.
 */
function Review({
  steps,
  onEdit,
  extra,
}: {
  steps: FlowStep[]
  onEdit: (index: number) => void
  extra?: ReactNode
}) {
  const t = useExtracted()

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {t("Check it over")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Tap anything to change it.")}
        </p>
      </div>

      <ul className="overflow-hidden rounded-xl border bg-card">
        {steps.map((step, index) => (
          <li key={step.id} className="border-b last:border-b-0">
            <button
              type="button"
              onClick={() => onEdit(index)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-accent"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">
                  {step.title}
                </span>
                <span className="mt-0.5 block truncate text-sm font-medium">
                  {step.summary ?? (
                    <span className="text-muted-foreground">
                      {t("Not set")}
                    </span>
                  )}
                </span>
              </span>
              <PencilIcon className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>

      {extra}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CheckIcon className="size-3.5 text-primary" />
        {t("Nothing is saved until you tap the button below.")}
      </p>
    </section>
  )
}
