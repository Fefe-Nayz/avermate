"use client"

import * as React from "react"
import { PipetteIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
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
 * hands you. Anything the square cannot represent is left alone rather than
 * rounded to hex behind your back.
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

function hexToHsv(hex: string): Hsv | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null

  const int = Number.parseInt(match[1] as string, 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
  }
  h = Math.round(h * 60)
  if (h < 0) h += 360

  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

/**
 * What the browser makes of an arbitrary CSS colour. `oklch(…)`, a named
 * colour and a hex string all round-trip through here, so the swatch shows the
 * real thing rather than a guess.
 */
function resolveCss(value: string): string | null {
  if (typeof document === "undefined" || !value.trim()) return null
  const probe = document.createElement("span")
  probe.style.color = ""
  probe.style.color = value
  if (!probe.style.color) return null

  probe.style.display = "none"
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved || null
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

  React.useEffect(() => setDraft(value), [value])

  // The square can only represent what it can parse. Everything else keeps its
  // own notation and simply is not draggable, which is better than rewriting a
  // designer's `oklch()` into a lossy hex the moment the popover opens.
  const hsv = hexToHsv(value) ?? { h: 210, s: 0.5, v: 0.6 }
  const editable = hexToHsv(value) !== null
  const swatch = resolveCss(value) ?? "transparent"

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
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={label}
            className={cn("size-7 shrink-0 rounded-full border p-0", className)}
          />
        }
      >
        <span
          aria-hidden
          className="size-full rounded-full"
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
      </PopoverTrigger>

      <PopoverContent className="w-60 space-y-3 p-3" align="start">
        <div
          ref={areaRef}
          role="application"
          aria-label={label}
          onPointerDown={(event) => {
            if (!editable) return
            event.currentTarget.setPointerCapture(event.pointerId)
            pickFromEvent(event)
          }}
          onPointerMove={(event) => {
            if (!editable || event.buttons !== 1) return
            pickFromEvent(event)
          }}
          className={cn(
            "relative h-32 w-full rounded-lg border",
            editable ? "cursor-crosshair" : "cursor-not-allowed opacity-40"
          )}
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
          disabled={!editable}
          aria-label={label ? `${label} — hue` : "Hue"}
          onChange={(event) =>
            commit({ ...hsv, h: Number(event.target.value) })
          }
          className="h-3 w-full cursor-pointer appearance-none rounded-full disabled:opacity-40 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow"
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
