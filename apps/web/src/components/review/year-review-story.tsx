"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import confetti from "canvas-confetti";
import { XIcon } from "lucide-react";
import { useFormatter, useExtracted } from "next-intl";
import { heatmapDays, type AwardKind, type Year, type YearReview } from "@avermate/core";
import { Button } from "@/components/ui/button";
import { useYear } from "@/components/year/year-provider";
import { orpc } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { usePreferences } from "@/hooks/use-preferences";
import { cn } from "@/lib/utils";

/**
 * The recap, told as a story.
 *
 * Tap the right half to move on, the left half to go back, and it advances on
 * its own if you do nothing — the pattern every phone user already knows.
 * Slides are full-bleed and portrait-first because this is the one screen in
 * the app people screenshot and send to a friend.
 */

const SLIDE_MS = 5200;

export function YearReviewStory({
  review,
  year,
  onClose,
}: {
  review: YearReview;
  year: Year;
  onClose: () => void;
}) {
  const t = useExtracted();
  const format = useFormatter();
  const { scale, yearId } = useYear();
  const { preferences } = usePreferences();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const celebrated = useRef(false);

  const markSeen = useMutation(orpc.review.markSeen.mutationOptions());

  const mark = (ratio: number | null) =>
    ratio === null ? "—" : format.number(ratio * scale, { maximumFractionDigits: 2 });

  const awardCopy: Record<AwardKind, { title: string; body: string }> = {
    tourist: {
      title: t("The Visitor"),
      body: t("You dropped by. The year is still mostly ahead of you."),
    },
    tightrope: {
      title: t("The Tightrope Walker"),
      body: t("Right on the line, all year, and you never fell off."),
    },
    comeback: {
      title: t("The Comeback"),
      body: t("You started slow and finished somewhere else entirely."),
    },
    allin: {
      title: t("All In"),
      body: t("Brilliant somewhere, quietly ignoring somewhere else."),
    },
    masterclass: {
      title: t("Masterclass"),
      body: t("Consistently excellent. Not much more to say."),
    },
    unpredictable: {
      title: t("The Wildcard"),
      body: t("Nobody, including you, could guess the next result."),
    },
    precision: {
      title: t("The Metronome"),
      body: t("The same mark, over and over. Frighteningly steady."),
    },
    legend: {
      title: t("The Archivist"),
      body: t("You logged everything. Truly everything."),
    },
    avermatien: {
      title: t("The Regular"),
      body: t("You kept it up all year without making a thing of it."),
    },
  };

  const weekdays = [
    t("Sunday"),
    t("Monday"),
    t("Tuesday"),
    t("Wednesday"),
    t("Thursday"),
    t("Friday"),
    t("Saturday"),
  ];

  const heatmap = useMemo(
    () => heatmapDays(review.heatmap, new Date(year.startsAt)),
    [review.heatmap, year.startsAt],
  );

  const slides = useMemo(() => {
    const list: Array<{ key: string; node: React.ReactNode }> = [];

    list.push({
      key: "intro",
      node: (
        <Slide accent>
          <p className="text-sm uppercase tracking-[0.2em] opacity-70">
            {year.name}
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight">
            {t("Your year, in numbers.")}
          </h1>
          <p className="mt-3 max-w-xs opacity-80">
            {t("Everything you recorded, from the first grade to the last.")}
          </p>
        </Slide>
      ),
    });

    list.push({
      key: "count",
      node: (
        <Slide>
          <p className="opacity-70">{t("You recorded")}</p>
          <p className="numeric text-7xl font-semibold">{review.gradeCount}</p>
          <p className="text-2xl">{t("grades")}</p>
          {review.firstGradeAt && review.lastGradeAt ? (
            <p className="mt-4 max-w-xs text-sm opacity-70">
              {t("From {first} to {last}.", {
                first: format.dateTime(review.firstGradeAt, {
                  day: "numeric",
                  month: "long",
                }),
                last: format.dateTime(review.lastGradeAt, {
                  day: "numeric",
                  month: "long",
                }),
              })}
            </p>
          ) : null}
        </Slide>
      ),
    });

    if (review.busiestMonth || review.busiestWeekday) {
      list.push({
        key: "rhythm",
        node: (
          <Slide>
            <p className="opacity-70">{t("Your rhythm")}</p>
            <div className="mt-6 grid w-full max-w-xs grid-cols-[repeat(auto-fill,minmax(0.6rem,1fr))] gap-[3px]">
              {heatmap.slice(-182).map((day) => (
                <span
                  key={day.date}
                  className={cn(
                    "aspect-square rounded-[2px]",
                    day.count === 0
                      ? "bg-white/12"
                      : day.count === 1
                        ? "bg-white/40"
                        : day.count === 2
                          ? "bg-white/65"
                          : "bg-white",
                  )}
                />
              ))}
            </div>
            <div className="mt-6 space-y-1 text-sm opacity-80">
              {review.busiestWeekday ? (
                <p>
                  {t("{day} was your heaviest day.", {
                    day: weekdays[review.busiestWeekday.weekday] ?? "",
                  })}
                </p>
              ) : null}
              {review.longestStreak > 1 ? (
                <p>
                  {t("Your longest run was {count} days in a row.", {
                    count: String(review.longestStreak),
                  })}
                </p>
              ) : null}
            </div>
          </Slide>
        ),
      });
    }

    if (review.primeTime) {
      list.push({
        key: "prime",
        node: (
          <Slide>
            <p className="opacity-70">{t("Your peak was on")}</p>
            <p className="mt-2 text-3xl font-semibold">
              {format.dateTime(review.primeTime.date, {
                day: "numeric",
                month: "long",
              })}
            </p>
            <p className="numeric mt-4 text-6xl font-semibold">
              {mark(review.primeTime.ratio)}
            </p>
            <p className="mt-1 opacity-70">{t("your highest average all year")}</p>
          </Slide>
        ),
      });
    }

    if (review.topSubjects.length > 0) {
      list.push({
        key: "subjects",
        node: (
          <Slide>
            <p className="opacity-70">{t("You were strongest in")}</p>
            <ol className="mt-6 w-full max-w-xs space-y-3">
              {review.topSubjects.map((subject, position) => (
                <li key={subject.subjectId} className="flex items-center gap-3">
                  <span className="numeric text-2xl font-semibold opacity-50">
                    {position + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-lg">
                    {subject.name}
                  </span>
                  <span className="numeric text-lg font-semibold">
                    {mark(subject.ratio)}
                  </span>
                </li>
              ))}
            </ol>
          </Slide>
        ),
      });
    }

    if (review.bestProgression) {
      list.push({
        key: "progress",
        node: (
          <Slide>
            <p className="opacity-70">{t("Biggest turnaround")}</p>
            <p className="mt-3 text-4xl font-semibold">
              {review.bestProgression.name}
            </p>
            <p className="numeric mt-4 text-5xl font-semibold">
              +{mark(review.bestProgression.delta)}
            </p>
            <p className="mt-1 opacity-70">
              {t("between the first half and the second")}
            </p>
          </Slide>
        ),
      });
    }

    if (review.topPercentile > 0) {
      list.push({
        key: "percentile",
        node: (
          <Slide>
            <p className="opacity-70">{t("Among everyone on Avermate")}</p>
            <p className="numeric mt-3 text-7xl font-semibold">
              {t("top {percent}%", { percent: String(review.topPercentile) })}
            </p>
            <p className="mt-3 max-w-xs text-sm opacity-70">
              {t("Compared on general average, across every active year.")}
            </p>
          </Slide>
        ),
      });
    }

    list.push({
      key: "award",
      node: (
        <Slide accent>
          <p className="text-sm uppercase tracking-[0.2em] opacity-70">
            {t("Your title this year")}
          </p>
          <h2 className="mt-4 text-4xl font-semibold leading-tight">
            {awardCopy[review.award].title}
          </h2>
          <p className="mt-3 max-w-xs opacity-85">
            {awardCopy[review.award].body}
          </p>
          <p className="numeric mt-8 text-5xl font-semibold">
            {mark(review.average)}
          </p>
          <p className="opacity-70">{t("final average")}</p>
        </Slide>
      ),
    });

    return list;
  }, [review, year, t, format, heatmap, scale]);

  const total = slides.length;

  const go = useCallback(
    (direction: 1 | -1) => {
      haptic("selection");
      setIndex((current) => {
        const next = current + direction;
        if (next < 0) return 0;
        if (next >= total) {
          onClose();
          return current;
        }
        return next;
      });
    },
    [total, onClose],
  );

  useEffect(() => {
    if (paused || preferences.reduceMotion) return;
    const timer = setTimeout(() => go(1), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [index, paused, go, preferences.reduceMotion]);

  useEffect(() => {
    if (yearId) markSeen.mutate({ yearId, reviewKey: "annual" });
    // Recording the view once per open is the whole point; re-running when the
    // mutation object changes identity would fire it on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearId]);

  useEffect(() => {
    const onAward = slides[index]?.key === "award";
    if (!onAward || celebrated.current || preferences.reduceMotion) return;
    celebrated.current = true;
    haptic("success");
    void confetti({
      particleCount: 90,
      spread: 75,
      origin: { y: 0.6 },
      disableForReducedMotion: true,
    });
  }, [index, slides, preferences.reduceMotion]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-white">
      <div className="flex gap-1 px-3 pt-safe">
        <div className="flex w-full gap-1 pt-3">
          {slides.map((slide, position) => (
            <div
              key={slide.key}
              className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25"
            >
              <div
                className={cn(
                  "h-full bg-white transition-[width] ease-linear",
                  position < index && "w-full",
                  position === index && "w-full",
                  position > index && "w-0",
                )}
                style={
                  position === index && !preferences.reduceMotion
                    ? { animation: `story-progress ${SLIDE_MS}ms linear forwards` }
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center px-2 pt-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("Close")}
          className="ml-auto text-white hover:bg-white/10 hover:text-white"
          onClick={onClose}
        >
          <XIcon className="size-5" />
        </Button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={slides[index]?.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: preferences.reduceMotion ? 0 : 0.28 }}
            className="absolute inset-0"
          >
            {slides[index]?.node}
          </motion.div>
        </AnimatePresence>

        {/* Tap zones sit above the slide so the whole surface is navigable. */}
        <button
          type="button"
          aria-label={t("Previous")}
          className="absolute inset-y-0 left-0 w-1/3"
          onClick={() => go(-1)}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
        />
        <button
          type="button"
          aria-label={t("Next")}
          className="absolute inset-y-0 right-0 w-2/3"
          onClick={() => go(1)}
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
        />
      </div>

      <style>{`@keyframes story-progress { from { width: 0 } to { width: 100% } }`}</style>
    </div>
  );
}

function Slide({
  children,
  accent = false,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center px-8 pb-16 text-center",
        accent &&
          "bg-[radial-gradient(120%_80%_at_50%_0%,color-mix(in_oklab,var(--primary)_45%,transparent),transparent)]",
      )}
    >
      {children}
    </div>
  );
}
