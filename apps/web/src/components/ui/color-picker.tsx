"use client"

import * as React from "react"
import { PipetteIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * A colour picker that belongs to the app.
 *
 * `<input type="color">` opens the operating system's picker — a window the
 * app cannot style, position or theme, which on a settings screen full of
 * designed controls reads as a hole in the page. It also only speaks hex,
 * while these tokens are stored as `oklch(…)` as often as not, so the native
 * control silently shows grey for half the palette.
 *
 * This one is a saturation square and a hue slider, which is the arrangement
 * every design tool uses, plus the raw value kept editable underneath: the
 * square is for choosing, the field is for pasting the exact token a design
 * hands you. Every notation is draggable, because the browser is asked to
 * convert it rather than this file trying to.
 */

interface Hsv {
  h: number
  s: number
  v: number
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${f(5)}${f(3)}${f(1)}`
}


/**
 * Any CSS colour, as the three channels the square needs.
 *
 * Reading a computed `color` back is no good here: a browser hands `oklch()`
 * back as `oklab()` or `lab()`, which still needs parsing. A 1×1 canvas makes
 * the browser do the conversion and hands over plain bytes, so `oklch(…)`, a
 * keyword and a hex string all arrive in the same shape — and an unparseable
 * value simply leaves the fill untouched, which is how we detect it.
 */
function toRgb(value: string): [number, number, number] | null {
  if (typeof document === "undefined" || !value.trim()) return null

  const context = document.createElement("canvas").getContext("2d")
  if (!context) return null

  // Two passes against different backstops: an invalid value leaves the
  // previous fill in place, so a single pass cannot tell "invalid" from
  // "happens to equal the backstop".
  context.fillStyle = "#000000"
  context.fillStyle = value
  const first = context.fillStyle
  context.fillStyle = "#ffffff"
  context.fillStyle = value
  if (first !== context.fillStyle) return null

  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return [r as number, g as number, b as number]
}

function rgbToHsv([r, g, b]: [number, number, number]): Hsv {
  const red = r / 255
  const green = g / 255
  const blue = b / 255

  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === red) h = ((green - blue) / delta) % 6
    else if (max === green) h = (blue - red) / delta + 2
    else h = (red - green) / delta + 4
  }
  h = Math.round(h * 60)
  if (h < 0) h += 360

  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

export function ColorPicker({
  value,
  onValueChange,
  label,
  className,
  disabled,
}: {
  /** Any CSS colour: `#rrggbb`, `oklch(…)`, a keyword, or empty for unset. */
  value: string
  onValueChange: (value: string) => void
  label?: string
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  const areaRef = React.useRef<HTMLDivElement>(null)
  const dragging = React.useRef(false)

  React.useEffect(() => setDraft(value), [value])

  const rgb = React.useMemo(() => toRgb(value), [value])

  /**
   * Everything is draggable. The first version refused unless the value was
   * already a hex string, which disabled the square for exactly the two cases
   * that matter most: a token that is still unset, and one written as
   * `oklch(…)`. Since the canvas parses both, dragging simply starts from
   * whatever colour is really there — and only rewrites it once you drag.
   */
  const hsv = rgb ? rgbToHsv(rgb) : { h: 210, s: 0.6, v: 0.7 }
  const swatch = rgb ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})` : "transparent"

  const commit = (next: Hsv) => onValueChange(hsvToHex(next))

  const pickFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = areaRef.current?.getBoundingClientRect()
    if (!box) return
    commit({
      h: hsv.h,
      s: clamp((event.clientX - box.left) / box.width),
      v: clamp(1 - (event.clientY - box.top) / box.height),
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/*
       * A plain button, not the `Button` component. That one brings its own
       * height, padding and min-width, which fought `size-7` and left the
       * swatch an oval with the colour showing as a sliver down the middle.
       * A swatch is a coloured circle; it needs none of that.
       */}
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label={label}
            className={cn(
              "block size-6 shrink-0 rounded-full ring-1 ring-border transition-shadow outline-none hover:ring-2 hover:ring-ring/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              className
            )}
            style={
              swatch === "transparent"
                ? {
                    // An unset token reads as a hole, not as black.
                    backgroundImage:
                      "linear-gradient(45deg, var(--muted) 25%, transparent 25%, transparent 75%, var(--muted) 75%), linear-gradient(45deg, var(--muted) 25%, transparent 25%, transparent 75%, var(--muted) 75%)",
                    backgroundSize: "6px 6px",
                    backgroundPosition: "0 0, 3px 3px",
                  }
                : { background: swatch }
            }
          />
        }
      />

      <PopoverContent className="w-60 space-y-3 p-3" align="start">
        <div
          ref={areaRef}
          role="application"
          aria-label={label}
          onPointerDown={(event) => {
            // Capture on the square itself, so a drag that leaves its bounds
            // keeps reporting instead of stopping at the edge.
            event.currentTarget.setPointerCapture(event.pointerId)
            dragging.current = true
            pickFromEvent(event)
          }}
          onPointerMove={(event) => {
            if (dragging.current) pickFromEvent(event)
          }}
          onPointerUp={(event) => {
            dragging.current = false
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => {
            dragging.current = false
          }}
          className="relative h-32 w-full cursor-crosshair rounded-lg border touch-none"
          style={{
            backgroundColor: `hsl(${hsv.h} 100% 50%)`,
            backgroundImage:
              "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm ring-1 ring-black/30"
            style={{
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              background: hsvToHex(hsv),
            }}
          />
        </div>

        <input
          type="range"
          min={0}
          max={360}
          value={hsv.h}
          aria-label={label ? `${label} — hue` : "Hue"}
          onChange={(event) =>
            commit({ ...hsv, h: Number(event.target.value) })
          }
          className="h-3 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow"
          style={{
            background:
              "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
          }}
        />

        <div className="flex items-center gap-2">
          <PipetteIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={draft}
            aria-label={label ? `${label} — value` : "Colour value"}
            placeholder="#rrggbb, oklch(…)"
            className="h-7 font-mono text-[11px]"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              const next = draft.trim()
              if (next !== value) onValueChange(next)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
