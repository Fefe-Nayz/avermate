import { describe, expect, it } from "bun:test"
import {
  createAnimationSync,
  createElapsedTracker,
  nextStoryClock,
  type PromotedAnimation,
} from "./story-clock"

describe("nextStoryClock", () => {
  it("reads real time while the story plays, whatever the frame cost", () => {
    // The whole invariant. Every version of this that accumulated deltas lost
    // time somewhere — a pause, a slow frame, a backgrounded tab — and the loss
    // was permanent, which poisoned every compositor animation created after.
    expect(nextStoryClock(1_000, 1_016, false)?.timestamp).toBe(1_016)
    expect(nextStoryClock(1_000, 1_600, false)?.timestamp).toBe(1_600)
  })

  it("comes back from an absence with no lag at all", () => {
    // Leaving for the home screen and returning: frames stopped for 30 seconds
    // while real time did not. The first frame back is already in step, so no
    // entrance after it can be stamped as older than itself.
    expect(nextStoryClock(1_000, 31_000, false)?.timestamp).toBe(31_000)
  })

  it("holds exactly still while paused", () => {
    expect(nextStoryClock(1_000, 5_000, true)).toBeNull()
  })

  it("is back in step on the first frame after a pause", () => {
    // The clock sat at 1_000 through a four-second hold.
    expect(nextStoryClock(1_000, 5_000, false)?.timestamp).toBe(5_000)
  })

  it("keeps the delta plausible even when the timestamp leaps", () => {
    // Only velocity is derived from the delta, so a frame that spanned an
    // absence must not report one — while the timestamp still tells the truth.
    const next = nextStoryClock(1_000, 31_000, false)
    expect(next?.delta).toBe(40)
    expect(next?.timestamp).toBe(31_000)
  })

  it("never reports a delta of zero", () => {
    // Two callbacks in one frame would otherwise divide by it.
    expect(nextStoryClock(1_000, 1_000, false)?.delta).toBe(1)
  })
})

describe("createElapsedTracker", () => {
  it("reports the whole of a slow frame", () => {
    // The rule this replaces threw away any frame over 250ms as a backgrounded
    // tab. Mounting a slide that builds a chart is one long frame, so the clock
    // lost real time exactly when a slide appeared — which is why navigating by
    // hand was the reliable way to trigger the entrance bug.
    const tracker = createElapsedTracker()
    tracker.delta(1_000)

    expect(tracker.delta(1_600)).toBe(600)
  })

  it("counts nothing for the first frame it sees", () => {
    expect(createElapsedTracker().delta(5_000)).toBe(0)
  })

  it("excludes a stretch spent hidden rather than guessing at its length", () => {
    const tracker = createElapsedTracker()
    tracker.delta(1_000)
    tracker.delta(1_016)

    // Away for a minute; the page becomes visible and resets before the frame.
    tracker.reset()

    expect(tracker.delta(61_016)).toBe(0)
    expect(tracker.delta(61_032)).toBe(16)
  })
})

/**
 * A stand-in for a compositor-driven animation.
 *
 * `play()` and `pause()` move `playState` the way the real thing does, which is
 * the part the sweep branches on. `startTime` is a plain number, as it is in
 * every browser that reports one.
 */
function fakeAnimation(
  startTime: number | null,
  playState: AnimationPlayState = "running"
): PromotedAnimation & { playState: AnimationPlayState; plays: number } {
  return {
    startTime,
    playState,
    plays: 0,
    pause() {
      this.playState = "paused"
    },
    play() {
      this.plays += 1
      this.playState = "running"
    },
  }
}

describe("createAnimationSync", () => {
  it("gives a newly created animation back the time the story clock had lost", () => {
    // The library stamped it with the story clock, which is 900ms behind the
    // document timeline it will actually be played against.
    const animation = fakeAnimation(10_000)
    createAnimationSync()([animation], 900, false)

    expect(animation.startTime).toBe(10_900)
  })

  it("re-anchors one that was stamped so far back it is already finished", () => {
    // Measured in a browser: a 300ms opacity tween whose startTime is pushed
    // back 900ms reports `finished`, never `running`, with a computed opacity
    // of 1 on its first frame — so reading `running` as the condition, as the
    // first version did, skipped every broken animation.
    //
    // Covering it here is still only half the story. In a real page Motion
    // commits the final value and cancels the animation from `onfinish`, which
    // runs before any frame callback, so one this far gone never reaches the
    // sweep at all. Keeping the lag small enough that animations arrive late
    // rather than finished is the story clock's job, not this function's.
    const bornFinished = fakeAnimation(10_000, "finished")
    createAnimationSync()([bornFinished], 900, false)

    expect(bornFinished.startTime).toBe(10_900)
  })

  it("leaves a genuinely finished animation alone when the clock is on time", () => {
    // With no lag there is nothing to give back, so an entrance that really did
    // run its course is not dragged back to the start of itself.
    const done = fakeAnimation(10_000, "finished")
    createAnimationSync()([done], 0, false)

    expect(done.startTime).toBe(10_000)
  })

  it("leaves an animation alone once it has been seen", () => {
    // Anything already on screen was anchored correctly when it was created.
    // Re-anchoring it on a later frame would shove it backwards.
    const animation = fakeAnimation(10_000)
    const sync = createAnimationSync()

    sync([animation], 0, false)
    sync([animation], 900, false)
    sync([animation], 1_800, false)

    expect(animation.startTime).toBe(10_000)
  })

  it("does not touch an animation that has not started", () => {
    // It never received the story clock's stamp, and writing `startTime` to a
    // paused animation would start it playing.
    const idle = fakeAnimation(null, "idle")
    const held = fakeAnimation(10_000, "paused")
    const sync = createAnimationSync()

    sync([idle, held], 900, false)

    expect(idle.startTime).toBeNull()
    expect(held.startTime).toBe(10_000)
    expect(held.playState).toBe("paused")
  })

  it("does not re-anchor one it skipped when it later starts playing", () => {
    // The browser anchored it against the document timeline at `play()`, so it
    // is already right — the lag was never applied to it.
    const animation = fakeAnimation(10_000, "paused")
    const sync = createAnimationSync()

    sync([animation], 900, false)
    animation.play()
    sync([animation], 900, false)

    expect(animation.startTime).toBe(10_000)
  })

  it("leaves an animation whose play is still pending alone", () => {
    // It reports as running with no start time yet. Treating that absence as
    // zero would place it at the origin of the timeline — old beyond any
    // duration, and so finished on its first frame, which is the fault itself.
    const pending = fakeAnimation(null, "running")
    createAnimationSync()([pending], 900, false)

    expect(pending.startTime).toBeNull()
  })

  it("ignores a lag too small to be anything but measurement noise", () => {
    const animation = fakeAnimation(10_000)
    createAnimationSync()([animation], 0.4, false)

    expect(animation.startTime).toBe(10_000)
  })

  it("pauses what is running and resumes exactly that on the way out", () => {
    const running = fakeAnimation(10_000)
    const sync = createAnimationSync()

    sync([running], 0, true)
    expect(running.playState).toBe("paused")

    sync([running], 0, false)
    expect(running.playState).toBe("running")
    expect(running.plays).toBe(1)
  })

  it("catches an animation created after the pause began", () => {
    // This is what sweeping once, at the instant of the pause, missed: the next
    // phase's text ran at full speed behind a frozen story and was over before
    // it was resumed.
    const first = fakeAnimation(10_000)
    const late = fakeAnimation(10_000)
    const sync = createAnimationSync()

    sync([first], 0, true)
    sync([first, late], 0, true)

    expect(late.playState).toBe("paused")
  })

  it("puts an animation born during a pause back to its start before freezing it", () => {
    // Re-anchor first, then pause: frozen at the beginning of its entrance
    // rather than part-way through it.
    const born = fakeAnimation(10_000)
    createAnimationSync()([born], 900, true)

    expect(born.startTime).toBe(10_900)
    expect(born.playState).toBe("paused")
  })

  it("does not replay an entrance that finished before the pause", () => {
    const finished = fakeAnimation(10_000, "finished")
    const sync = createAnimationSync()

    sync([finished], 0, true)
    sync([finished], 0, false)

    expect(finished.plays).toBe(0)
    expect(finished.playState).toBe("finished")
  })

  it("only resumes on the transition, not on every playing frame", () => {
    const animation = fakeAnimation(10_000)
    const sync = createAnimationSync()

    sync([animation], 0, true)
    sync([animation], 0, false)
    sync([animation], 0, false)
    sync([animation], 0, false)

    expect(animation.plays).toBe(1)
  })

  it("does not resume across a pause it never saw the start of", () => {
    // The sweep begins on a playing story; nothing was caught, so nothing is
    // owed a `play()`.
    const animation = fakeAnimation(10_000, "paused")
    const sync = createAnimationSync()

    sync([animation], 0, false)

    expect(animation.plays).toBe(0)
    expect(animation.playState).toBe("paused")
  })
})
