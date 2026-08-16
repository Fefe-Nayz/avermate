/**
 * The scrubber's virtualization maths, kept in lockstep with the web's
 * `resolveScrubberTickStep` / `resolveVisibleScrubberDays`
 * (apps/web/src/components/shell/day-scrubber.tsx).
 */

const FALLBACK_TICK_TARGET = 96;
const MIN_TICK_GAP_PX = 4;

/** Keeps minor timeline ticks legible at every scrubber width. */
export function resolveScrubberTickStep(
  totalDays: number,
  width: number,
): number {
  if (totalDays <= 0) return 1;
  if (width <= 0) {
    return Math.max(1, Math.ceil((totalDays + 1) / FALLBACK_TICK_TARGET));
  }
  const visibleCapacity = Math.max(2, Math.floor(width / MIN_TICK_GAP_PX));
  return Math.max(1, Math.ceil((totalDays + 1) / visibleCapacity));
}

/** Mount only ticks that can be seen; month anchors are never dropped. */
export function resolveVisibleScrubberDays(
  totalDays: number,
  tickStep: number,
  monthStarts: readonly number[],
): number[] {
  const days = new Set<number>([0, totalDays]);
  for (let day = 0; day <= totalDays; day += Math.max(1, tickStep)) {
    days.add(day);
  }
  for (const day of monthStarts) {
    if (day >= 0 && day <= totalDays) days.add(day);
  }
  return [...days].sort((left, right) => left - right);
}
