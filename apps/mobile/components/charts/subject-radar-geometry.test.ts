import { describe, expect, test } from "bun:test";
import {
  labelAnchorFor,
  labelLines,
  labelRotation,
  polarPoint,
  radarScene,
  ringRadius,
} from "./subject-radar-geometry";

describe("subject radar geometry", () => {
  test("labels fold to stay readable past a quarter turn", () => {
    // Top spoke: name runs vertically, reads downward-to-centre.
    expect(labelRotation(0)).toBe(-90);
    expect(labelAnchorFor(0)).toBe("end");
    // Right spoke: horizontal.
    expect(labelRotation(Math.PI / 2)).toBe(0);
    expect(labelAnchorFor(Math.PI / 2)).toBe("end");
    // Bottom spoke sits exactly at the fold boundary and keeps its turn.
    expect(labelRotation(Math.PI)).toBe(90);
    expect(labelAnchorFor(Math.PI)).toBe("end");
    // Left spoke folds so the name is not upside down.
    expect(labelRotation(1.5 * Math.PI)).toBe(0);
    expect(labelAnchorFor(1.5 * Math.PI)).toBe("start");
  });

  test("a long name folds once into the two most even lines", () => {
    const lines = labelLines("Sciences industrielles avancées", 320, 320);
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toBe("Sciences industrielles avancées");
    // A short name never folds.
    expect(labelLines("Maths", 320, 320)).toEqual(["Maths"]);
  });

  test("the ring leaves room for names on narrow cards", () => {
    expect(ringRadius(320, 320) / (320 / 2)).toBeCloseTo(0.64, 6);
    expect(ringRadius(480, 480) / (480 / 2)).toBeCloseTo(0.72, 6);
  });

  test("polar projection measures from the top, clockwise", () => {
    expect(polarPoint(0, 0, 10, 0)).toEqual({ x: 0, y: -10 });
    const right = polarPoint(0, 0, 10, Math.PI / 2);
    expect(right.x).toBeCloseTo(10, 6);
    expect(right.y).toBeCloseTo(0, 6);
  });

  test("the scene clamps values inside the ring and keeps one vertex per subject", () => {
    const scene = radarScene({
      points: [
        { subject: "Maths", value: 15 },
        { subject: "Physique", value: 25 },
        { subject: "Anglais", value: 8 },
      ],
      scale: 20,
      width: 360,
      height: 340,
    });
    expect(scene.vertices).toHaveLength(3);
    expect(scene.gridRings).toHaveLength(5);
    // Overshooting value clamps to the outer ring.
    const clamped = scene.vertices[1]!;
    const distance = Math.hypot(clamped.x - scene.cx, clamped.y - scene.cy);
    expect(distance).toBeLessThanOrEqual(scene.ring + 1e-6);
  });
});
