"use client"

import confetti from "canvas-confetti"
import { useCallback, useEffect, useRef } from "react"

type ConfettiInstance = ReturnType<typeof confetti.create>
export type ConfettiBurst = Parameters<ConfettiInstance>[0]

/**
 * Confetti that survives the story being used.
 *
 * The bursts used to stop working for the rest of the session — pause and
 * resume, leave the app, move between slides quickly, and from then on nothing
 * appeared until the page was reloaded. Two things in how they were set up made
 * that inevitable.
 *
 * **The worker was shared.** `canvas-confetti` keeps one worker for the whole
 * page — `getWorker` closes over a single `worker` and returns it to every
 * caller — and inside it a single `CONFETTI`, rebuilt each time a canvas is
 * handed over:
 *
 *     } else if (msg.data.canvas) {
 *       CONFETTI = module.exports.create(msg.data.canvas);
 *     }
 *
 * The story has two confetti canvases. Whichever initialised second rebound that
 * one `CONFETTI` onto its own canvas, and the other slide's instance went on
 * posting to the same worker, which drew its particles onto a canvas that was no
 * longer in the document. Nothing was broken in any way the code could see; the
 * confetti was simply landing somewhere else. `transferControlToOffscreen` is
 * one-way, so nothing recovered short of a reload. Dropping the worker gives
 * each canvas its own animation on the main thread, where two can coexist. The
 * bursts are short and there are two of them in the whole story, so the thread
 * was never what needed protecting.
 *
 * **The instance outlived its canvas.** It was created once, guarded on the ref
 * being empty, and never cleared — so a slide revisited, or re-rendered with a
 * fresh `<canvas>`, kept firing at the old detached one. Here the canvas node is
 * stored with the instance and compared on every burst, so an instance is only
 * ever used with the canvas it was built for.
 */
export function useStoryConfetti(
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  const boundRef = useRef<{
    node: HTMLCanvasElement
    fire: ConfettiInstance
  } | null>(null)

  useEffect(
    () => () => {
      boundRef.current?.fire.reset()
      boundRef.current = null
    },
    []
  )

  /** Throws a burst. Answers whether there was a canvas to throw it at. */
  return useCallback(
    (burst: ConfettiBurst): boolean => {
      const node = canvasRef.current
      if (!node) return false

      if (boundRef.current?.node !== node) {
        boundRef.current?.fire.reset()
        boundRef.current = {
          node,
          // `resize: false` because the canvas carries the story's canonical
          // dimensions as attributes and is stretched to fit by CSS. Letting the
          // library measure it instead would read whatever size it happened to
          // have at the first burst — and it only ever measures once.
          fire: confetti.create(node, { resize: false, useWorker: false }),
        }
      }

      boundRef.current.fire(burst)
      return true
    },
    [canvasRef]
  )
}
