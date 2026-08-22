import { z } from "zod";
import { canonicalJson, sha256 } from "../search/values";

const scalar = z.number().finite().min(-10_000).max(10_000);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/u);

export const manimSceneDslV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  durationMs: z.number().int().min(250).max(5 * 60_000),
  background: color.default("#000000"),
  objects: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({
          id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
          kind: z.literal("text"),
          text: z.string().min(1).max(1_000),
          x: scalar,
          y: scalar,
          color,
        }),
        z.strictObject({
          id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
          kind: z.literal("line"),
          from: z.tuple([scalar, scalar]),
          to: z.tuple([scalar, scalar]),
          color,
        }),
        z.strictObject({
          id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
          kind: z.literal("circle"),
          center: z.tuple([scalar, scalar]),
          radius: z.number().positive().max(10_000),
          color,
        }),
      ]),
    )
    .min(1)
    .max(250),
  animations: z
    .array(
      z.strictObject({
        objectId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
        effect: z.enum(["appear", "fade-in", "fade-out", "move", "draw"]),
        startMs: z.number().int().nonnegative(),
        durationMs: z.number().int().positive().max(60_000),
        to: z.tuple([scalar, scalar]).optional(),
      }),
    )
    .max(1_000),
}).superRefine((scene, context) => {
  const ids = new Set(scene.objects.map((object) => object.id));
  if (ids.size !== scene.objects.length) {
    context.addIssue({ code: "custom", path: ["objects"], message: "object IDs must be unique" });
  }
  for (const [index, animation] of scene.animations.entries()) {
    if (!ids.has(animation.objectId)) {
      context.addIssue({ code: "custom", path: ["animations", index, "objectId"], message: "animation object must exist" });
    }
    if (animation.startMs + animation.durationMs > scene.durationMs) {
      context.addIssue({ code: "custom", path: ["animations", index], message: "animation exceeds scene duration" });
    }
    if (animation.effect === "move" && !animation.to) {
      context.addIssue({ code: "custom", path: ["animations", index, "to"], message: "move requires a destination" });
    }
  }
});

export type ManimSceneDslV1 = z.infer<typeof manimSceneDslV1Schema>;

/** The API validates data only; a reviewed sandbox worker owns DSL translation. */
export function validateManimSceneDsl(value: unknown) {
  const scene = manimSceneDslV1Schema.parse(value);
  return Object.freeze({ scene, digest: sha256(canonicalJson(scene)) });
}

