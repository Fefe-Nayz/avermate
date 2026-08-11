import { TargetIcon, TrendingUpIcon } from "lucide-react"
import { useExtracted } from "next-intl"

/**
 * The half of the auth card that is not the form.
 *
 * Hidden below `md`, where the form is the only thing worth the width. The
 * sample is labelled as a sample: a fabricated average set in the app's own
 * type, at the size the real dashboard uses, invites being read as data.
 */
export function AuthAside() {
  const t = useExtracted()

  const bars = [30, 38, 34, 47, 44, 56, 62, 58, 69, 76, 82, 88]

  return (
    <aside className="relative hidden flex-col justify-center gap-6 border-l bg-sidebar p-8 md:flex">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.16] [background:radial-gradient(circle_at_70%_20%,var(--primary),transparent_55%)]"
      />

      <div className="relative">
        <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
          {t("Your school year, made clear")}
        </p>
        <h2 className="mt-3 text-2xl leading-tight font-semibold tracking-tight text-balance">
          {t("Every grade has an impact. See it before the next one.")}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t(
            "Avermate follows your coefficients, explains your progress and turns a target into the results it would take."
          )}
        </p>
      </div>

      <figure className="relative space-y-3">
        <figcaption className="text-[11px] tracking-wide text-muted-foreground uppercase">
          {t("A sample year")}
        </figcaption>

        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">
                {t("General average")}
              </p>
              <p className="numeric mt-1 text-2xl font-semibold tracking-tight">
                15.84
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-positive/12 px-2 py-0.5 text-xs text-positive">
              <TrendingUpIcon className="size-3" /> +0.42
            </span>
          </div>
          <div className="mt-4 flex h-14 items-end gap-1" aria-hidden>
            {bars.map((height, index) => (
              <span
                key={`${height}-${index}`}
                className="flex-1 rounded-t bg-gradient-to-t from-primary/15 to-primary/80"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3">
          <TargetIcon className="size-4 shrink-0 text-primary" />
          <p className="text-sm">
            {t("Next target")}{" "}
            <span className="numeric font-semibold">16.5</span>
          </p>
          <p className="ml-auto text-xs text-muted-foreground">
            {t("A plan, not a guess")}
          </p>
        </div>
      </figure>
    </aside>
  )
}
