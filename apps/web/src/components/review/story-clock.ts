"use client"

import { useEffect, useRef } from "react"

/**
 * Story time: the clock every moving thing in the review must share.
 *
 * The story had five of them. Motion's main-thread tweens ran on a manual
 * timestamp the story controlled; Motion's WAAPI-promoted tweens ran on the
 * document timeline; the slide choreography ran on `setTimeout`; two hand-rolled
 * loops ran on raw `requestAnimationFrame`; and `canvas-confetti` ran on its own
 * scheduler. Pausing reached the first two. The other three carried on.
 *
 * That is why pausing froze what was on screen but a line of text scheduled for
 * later still arrived on time, and why the entrance glitches had no reproducible
 * pattern: what you saw depended on where the timers happened to land relative
 * to the pause, which is different on every run.
 *
 * A delay expressed through the hooks here is measured in story time — it stops
 * accruing while paused and resumes with exactly the time it had left, rather
 * than having elapsed in the background.
 *
 * Sharing a clock is not enough on its own, though, because one of those five
 * cannot be moved onto it: an animation the library hands to the compositor is
 * played against the document timeline whatever this clock says. Reconciling
 * the two is `createAnimationSync`, at the bottom of this file.
 */

/**
 * Frame-to-frame elapsed time, with time spent hidden excluded.
 *
 * For the story's own hand-drawn animations — a line tracing itself — an
 * absence should cost nothing: come back and the line is where you left it, not
 * finished. `reset` is called when the page becomes visible, so the single
 * enormous gap that spans an absence contributes nothing, while a slow frame is
 * absorbed in full.
 *
 * The rule this replaces guessed at the difference with a threshold, dropping
 * any gap over 250ms. Slow frames cross that line constantly — mounting a slide
 * that builds a chart is one long frame — so it discarded real time on exactly
 * the frames where a slide appears.
 *
 * Note that this deliberately loses time, which is why `nextStoryClock` does
 * not use it. Anything the compositor animates has to be stamped in real time,
 * and a tracker that skips is the opposite of what that needs.
 */
export function createElapsedTracker() {
  let last: number | null = null

  return {
    /** Elapsed since the previous frame. Zero when there was no previous one. */
    delta(now: number): number {
      const elapsed = last === null ? 0 : now - last
      last = now
      return elapsed
    },
    /** Time spent away is not elapsed time: the next frame starts fresh. */
    reset(): void {
      last = null
    },
  }
}

/**
 * The largest frame delta the library itself will admit.
 *
 * Only velocity is derived from the delta, so a frame that spanned an absence
 * would produce a nonsensical one. The timestamp is the authoritative half.
 */
const MAX_DELTA_MS = 40

/**
 * Where the story clock goes next. `null` means leave it exactly where it is.
 *
 * One invariant, and every entrance bug in this story came from not holding it:
 * **while the story plays, this clock reads real time.** Not real time minus
 * what a pause cost, not real time minus a slow frame — real time.
 *
 * It matters because the library stamps the animations it hands to the
 * compositor with whatever this clock says, and writes that stamp into
 * `animation.startTime`, which the browser reads as document-timeline time. Any
 * gap between the two is therefore read as age. An animation stamped as older
 * than its own duration is over before it is shown, and `onfinish` responds by
 * committing the final value to the element's inline style and cancelling the
 * animation — so it cannot be repaired afterwards, only prevented. One that
 * repeats forever cannot be over, but it starts at whatever phase that age
 * lands on, which is why a pulse ring appeared at full size and full opacity.
 *
 * The gap used to be accumulated deliberately. Advancing by summed frame deltas
 * meant every millisecond not counted was lost for good: a pause, a slow frame,
 * and worst of all a backgrounded tab, where frames stop entirely while real
 * time does not. Leaving the site for the home screen and coming back therefore
 * put this clock permanently behind by however long you were away, which broke
 * every entrance from then on — reliably, and only on the phones where that is
 * a normal thing to do.
 *
 * Assigning the frame's own timestamp instead of adding to the previous one
 * makes all of that impossible rather than handled. A pause still freezes the
 * clock, because holding every animation on its exact frame is the point of it,
 * and the freeze ends on the first frame that plays.
 */
export function nextStoryClock(
  previous: number,
  now: number,
  paused: boolean
): { timestamp: number; delta: number } | null {
  if (paused) return null
  return {
    timestamp: now,
    delta: Math.max(1, Math.min(now - previous, MAX_DELTA_MS)),
  }
}

/** A timeout that does not run down while the story is paused. */
export function useStoryTimeout(
  callback: () => void,
  delay: number | null,
  paused: boolean
): void {
  const latest = useRef(callback)
  useEffect(() => {
    latest.current = callback
  }, [callback])

  const remaining = useRef(delay ?? 0)
  const fired = useRef(false)

  // A new delay is a new timer, not a resumption of the old one.
  useEffect(() => {
    remaining.current = delay ?? 0
    fired.current = false
  }, [delay])

  useEffect(() => {
    if (delay === null || paused || fired.current) return

    const startedAt = performance.now()
    const id = window.setTimeout(
      () => {
        fired.current = true
        remaining.current = 0
        latest.current()
      },
      Math.max(0, remaining.current)
    )

    return () => {
      window.clearTimeout(id)
      // Banking what is left is what makes this a pause rather than a restart:
      // resuming waits out the remainder, not the whole delay again.
      if (!fired.current) {
        remaining.current = Math.max(
          0,
          remaining.current - (performance.now() - startedAt)
        )
      }
    }
  }, [delay, paused])
}

/**
 * A frame loop measured in story time.
 *
 * `elapsed` counts only the frames that ran, so an animation driven by it holds
 * its exact position across a pause instead of jumping forward by however long
 * the story sat still.
 */
export function useStoryFrame(
  callback: (elapsed: number) => void,
  active: boolean,
  paused: boolean
): void {
  const latest = useRef(callback)
  useEffect(() => {
    latest.current = callback
  }, [callback])

  const elapsed = useRef(0)

  useEffect(() => {
    if (!active) elapsed.current = 0
  }, [active])

  useEffect(() => {
    if (!active || paused) return

    let frame = 0
    const tracker = createElapsedTracker()
    const onVisibility = () => {
      if (document.visibilityState === "visible") tracker.reset()
    }
    document.addEventListener("visibilitychange", onVisibility)

    const tick = (now: number) => {
      elapsed.current += tracker.delta(now)
      latest.current(elapsed.current)
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [active, paused])
}

/**
 * The part of `Animation` the sweep below touches.
 *
 * Narrower than the real thing so the sweep can be exercised without a DOM —
 * the arithmetic is the part worth pinning down, and it is the part that is
 * impossible to eyeball in a running story.
 */
export interface PromotedAnimation {
  readonly playState: AnimationPlayState
  startTime: CSSNumberish | null
  pause(): void
  play(): void
}

/**
 * Keeps compositor-driven animations on the story's clock.
 *
 * The library promotes opacity, transform, filter, clipPath and
 * backgroundColor to the Web Animations API, which runs on the document
 * timeline — real time — rather than the story clock above. When it creates an
 * animation it stamps it with `time.now()`, which under `useManualTiming` reads
 * the story clock, and for a promoted animation it writes that stamp straight
 * into `animation.startTime` — a field the browser reads as document-timeline
 * time. The story clock's value is therefore interpreted as real time.
 *
 * The story clock is behind real time only while a pause holds it there, and
 * `nextStoryClock` puts it back on the first frame that plays. What follows is
 * what that lag does while it lasts. An animation stamped with a start time
 * `lag` milliseconds in the past is one the browser considers `lag`
 * milliseconds old, so once the lag passes its duration it is *born finished*
 * and the element paints its final value on its very first frame.
 *
 * That is the entrance that never plays: cards standing fully visible while
 * only their scale travels, because the scale is staggered on the main thread —
 * still on the story clock, still correct — while the opacity it was supposed
 * to travel with was over before it was painted. It is also why the fault had
 * no pattern. The lag starts at zero, so a clean uninterrupted run looks right,
 * and every pause makes the next entrance worse.
 *
 * Two jobs, both needing a look at every animation every frame:
 *
 *  1. **Re-anchor.** An animation seen for the first time was created within
 *     the last frame, so on the document timeline its start time can only be
 *     now. Whatever it is behind by is the lag, so add it back.
 *
 *     This reaches only the animations that still exist. Past its own duration
 *     an animation is not merely late but over, and `NativeAnimation.onfinish`
 *     answers that by committing the final value to the element's inline style
 *     and cancelling the animation — before any frame callback runs. Nothing
 *     survives for this to correct, which is why the story clock is put back on
 *     real time the moment the story resumes rather than carrying a pause
 *     forward as a permanent offset. That keeps the lag small enough that what
 *     arrives here is late rather than finished.
 *  2. **Pause and resume.** Only animations this caught are resumed, so a
 *     finished entrance does not replay when the story does. Sweeping once, at
 *     the instant of the pause, missed everything created afterwards — the next
 *     phase's text, an entrance staggered behind the others — which then ran at
 *     full speed behind a frozen story. Pause is a state, not an event.
 *
 * Re-anchoring runs first, so an animation created *during* a pause is put back
 * to its start before being frozen there rather than frozen part-way in.
 */
export function createAnimationSync() {
  const seen = new WeakSet<PromotedAnimation>()
  const caught = new Set<PromotedAnimation>()
  let wasPaused = false

  return function sync(
    animations: Iterable<PromotedAnimation>,
    lag: number,
    paused: boolean
  ): void {
    for (const animation of animations) {
      if (!seen.has(animation)) {
        seen.add(animation)
        // `finished` is the state that matters most, and reading it as a
        // reason to skip is what made the first attempt at this fix do nothing
        // at all. An animation stamped far enough into the past is already
        // beyond its own end on arrival, so it never reports `running` — it is
        // born `finished`. Measured on a 300ms opacity tween pushed back 900ms:
        //
        //   left alone   →  running,  currentTime 0,    opacity 0   ✓
        //   stamped back →  finished, currentTime 900,  opacity 1   ✗
        //   re-anchored  →  running,  currentTime 0,    opacity 0   ✓
        //
        // So the broken ones were precisely the ones being skipped, and putting
        // the time back revives the entrance in full.
        //
        // The two states left out are left out deliberately: writing
        // `startTime` to a `paused` animation starts it playing, and an `idle`
        // one has no start time to correct — it was never given the story
        // clock's stamp, and the browser anchors it itself when it starts.
        const started =
          animation.playState === "running" ||
          animation.playState === "finished"

        if (lag > 1 && started) {
          // An animation whose play is still pending reports as running with
          // no start time at all, and `Number(null)` is 0 — which would read as
          // an animation begun at the origin of the timeline, so unimaginably
          // old that it is finished on arrival. Exactly the fault being fixed.
          //
          // Past that, `startTime` is declared `CSSNumberish`, so a browser may
          // report a `CSSNumericValue` rather than a number. That converts to
          // NaN and is left alone, which is right: there would be no unit to
          // add `lag` in. The browser anchors both cases itself in the end.
          const anchor =
            animation.startTime === null ? NaN : Number(animation.startTime)
          if (Number.isFinite(anchor)) animation.startTime = anchor + lag
        }
      }

      if (paused && animation.playState === "running") {
        animation.pause()
        caught.add(animation)
      }
    }

    if (wasPaused && !paused) {
      for (const animation of caught) {
        // One that ran to its end while frozen is finished, not paused, and
        // playing it would restart it.
        if (animation.playState === "paused") animation.play()
      }
      caught.clear()
    }
    wasPaused = paused
  }
}
