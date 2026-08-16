/**
 * The radar's geometry, ported from the web's `subject-radar-spec.ts` so both
 * clients place the same name on the same spoke at the same fold. Pure maths
 * only — the SVG renderer stays in `subject-radar.tsx`.
 */

export interface RadarPoint {
  subject: string;
  value: number;
}

/** Advance width of a character, as a fraction of the font size. */
export const CHARACTER_WIDTH = 0.55;
/** How far past the ring the outer end of every name sits. */
export const LABEL_OFFSET = 10;
/** Baseline-to-baseline distance between the lines of a folded name. */
export const LINE_HEIGHT = 1.15;

/** Bring a rotation into the half turn a reader can follow. */
function fold(degrees: number): { rotation: number; flipped: boolean } {
  let rotation = degrees;
  let flipped = false;
  while (rotation > 90) {
    rotation -= 180;
    flipped = !flipped;
  }
  while (rotation < -90) {
    rotation += 180;
    flipped = !flipped;
  }
  return { rotation, flipped };
}

/** Lay a name along its own spoke, pointing at the centre. */
export function labelRotation(angle: number): number {
  return fold((angle * 180) / Math.PI - 90).rotation;
}

/** Which end of a name is pinned to its spoke. */
export function labelAnchorFor(angle: number): "start" | "end" {
  return fold((angle * 180) / Math.PI - 90).flipped ? "start" : "end";
}

/** How much of the box the ring takes, leaving the rest to the names. */
export function radiusRatioFor(width: number): number {
  return width < 360 ? 0.64 : 0.72;
}

/** The ring's radius in pixels. */
export function ringRadius(width: number, height: number): number {
  return (Math.min(width, height) / 2) * radiusRatioFor(width);
}

/** Names shrink a step at a time as the card narrows, before they fold. */
export function labelFontSizeFor(width: number): number {
  return width < 340 ? 10 : width < 440 ? 11 : 12;
}

/** How long a run of characters may lie along a spoke. */
export function labelBudget(width: number, height: number): number {
  const ring = ringRadius(width, height);
  return ring + LABEL_OFFSET - Math.max(ring * 0.25, 22);
}

/**
 * A name, folded to fit its spoke — never cut. A name that overruns its
 * budget breaks once, at a space or after a hyphen, into the two most even
 * lines it can make.
 */
export function labelLines(
  name: string,
  width: number,
  height: number,
): string[] {
  const budget = labelBudget(width, height);
  const advance = labelFontSizeFor(width) * CHARACTER_WIDTH;
  if (name.length * advance <= budget) return [name];

  const tokens = name.match(/[^\s-]+-|[^\s]+/g) ?? [name];
  if (tokens.length < 2) return [name];

  const join = (parts: string[]) =>
    parts.reduce(
      (text, part) =>
        text === ""
          ? part
          : text.endsWith("-")
            ? text + part
            : `${text} ${part}`,
      "",
    );

  let best: [string, string] = [
    join(tokens.slice(0, 1)),
    join(tokens.slice(1)),
  ];
  for (let split = 2; split < tokens.length; split += 1) {
    const candidate: [string, string] = [
      join(tokens.slice(0, split)),
      join(tokens.slice(split)),
    ];
    if (
      Math.max(candidate[0].length, candidate[1].length) <
      Math.max(best[0].length, best[1].length)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Polar projection with the chart convention: angle measured from the top,
 * clockwise.
 */
export function polarPoint(
  cx: number,
  cy: number,
  r: number,
  angle: number,
): { x: number; y: number } {
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) };
}

export interface RadarLabelLine {
  key: string;
  text: string;
  x: number;
  y: number;
  rotation: number;
  anchor: "start" | "end";
}

export interface RadarScene {
  cx: number;
  cy: number;
  ring: number;
  fontSize: number;
  /** One polygon point string per grid ring, innermost first. */
  gridRings: Array<{ value: number; points: string }>;
  /** Ring value labels along the right-pointing spoke. */
  gridLabels: Array<{ value: number; x: number; y: number }>;
  /** One line from the centre to the ring per subject. */
  spokes: Array<{ key: string; x: number; y: number }>;
  /** The data polygon. */
  area: string;
  /** Data vertices, for the tap tooltip. */
  vertices: Array<{ subject: string; value: number; x: number; y: number }>;
  labels: RadarLabelLine[];
}

/** Everything the renderer draws, computed once per size/data change. */
export function radarScene({
  points,
  scale,
  width,
  height,
}: {
  points: readonly RadarPoint[];
  scale: number;
  width: number;
  height: number;
}): RadarScene {
  const cx = width / 2;
  const cy = height / 2;
  const ring = ringRadius(width, height);
  const fontSize = labelFontSizeFor(width);
  const lineHeight = fontSize * LINE_HEIGHT;
  const count = Math.max(1, points.length);
  const angleAt = (index: number) => (index * 2 * Math.PI) / count;

  const polygon = (radius: number) =>
    points
      .map((_point, index) => {
        const { x, y } = polarPoint(cx, cy, radius, angleAt(index));
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

  const ringValues = [0, scale * 0.25, scale * 0.5, scale * 0.75, scale];

  const labels: RadarLabelLine[] = points.flatMap((point, index) => {
    const angle = angleAt(index);
    const rotation = labelRotation(angle);
    const anchor = labelAnchorFor(angle);
    const radians = (rotation * Math.PI) / 180;
    const across = { x: -Math.sin(radians), y: Math.cos(radians) };
    const anchorPoint = polarPoint(cx, cy, ring + LABEL_OFFSET, angle);
    const lines = labelLines(point.subject, width, height);

    return lines.map((text, line) => {
      const offset = (line - (lines.length - 1) / 2) * lineHeight;
      return {
        key: `${point.subject}#${line}`,
        text,
        x: anchorPoint.x + across.x * offset,
        y: anchorPoint.y + across.y * offset,
        rotation,
        anchor,
      };
    });
  });

  return {
    cx,
    cy,
    ring,
    fontSize,
    gridRings: ringValues.map((value) => ({
      value,
      points: polygon((value / scale) * ring),
    })),
    gridLabels: ringValues.map((value) => {
      const { x, y } = polarPoint(cx, cy, (value / scale) * ring, Math.PI / 2);
      return { value, x: x + 6, y };
    }),
    spokes: points.map((point, index) => {
      const { x, y } = polarPoint(cx, cy, ring, angleAt(index));
      return { key: point.subject, x, y };
    }),
    area: polygon(0)
      ? points
          .map((point, index) => {
            const { x, y } = polarPoint(
              cx,
              cy,
              (Math.max(0, Math.min(scale, point.value)) / scale) * ring,
              angleAt(index),
            );
            return `${x.toFixed(2)},${y.toFixed(2)}`;
          })
          .join(" ")
      : "",
    vertices: points.map((point, index) => {
      const { x, y } = polarPoint(
        cx,
        cy,
        (Math.max(0, Math.min(scale, point.value)) / scale) * ring,
        angleAt(index),
      );
      return { subject: point.subject, value: point.value, x, y };
    }),
    labels,
  };
}
