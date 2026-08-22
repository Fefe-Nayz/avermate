import {
  manimWorkerManifestV1Schema,
  manimWorkerOutputV1Schema,
  type ManimSceneDslV1,
  type ManimWorkerManifestV1,
} from "@avermate/agent-contracts";
import { copyFile, lstat, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  INPUT_MANIFEST_PATH,
  OUTPUT_ROOT,
  type CommandRunner,
  outputFile,
  parseExactOptions,
  prepareWorkspace,
  readJsonManifest,
  requireCommandSuccess,
  runCommand,
  writeJsonOutput,
} from "./runtime";

const MANIM = "/usr/bin/manim";
const FFPROBE = "/usr/bin/ffprobe";

export function manimBuildCli(argv: readonly string[]) {
  const parsed = parseExactOptions(argv, ["input", "output", "manifest"]);
  if (
    parsed.input !== INPUT_MANIFEST_PATH ||
    parsed.output !== `${OUTPUT_ROOT}/scene.mp4` ||
    parsed.manifest !== `${OUTPUT_ROOT}/render.json`
  ) {
    throw new Error("MANIM_WORKER_PATH_INVALID");
  }
  return Object.freeze({
    input: parsed.input,
    output: parsed.output,
    manifest: parsed.manifest,
  });
}

export function manimArguments(
  manifest: ManimWorkerManifestV1,
  root = "/workspace",
): readonly string[] {
  return Object.freeze([
    "--disable_caching",
    "--format",
    "mp4",
    "--renderer",
    "cairo",
    "--resolution",
    `${manifest.height},${manifest.width}`,
    "--frame_rate",
    String(manifest.fps),
    "--media_dir",
    join(root, "tmp", "manim"),
    "--output_file",
    "scene",
    join(root, "tmp", "scene.py"),
    "AvermateScene",
  ]);
}

/** Translate the reviewed data DSL; no input is inserted as Python syntax. */
export function renderManimPython(scene: ManimSceneDslV1): string {
  const objectLines = scene.objects.map((object) => {
    const key = JSON.stringify(object.id);
    if (object.kind === "text") {
      return `objects[${key}] = Text(${JSON.stringify(object.text)}, color=${JSON.stringify(object.color)}).move_to([${number(object.x)}, ${number(object.y)}, 0])`;
    }
    if (object.kind === "line") {
      return `objects[${key}] = Line([${number(object.from[0])}, ${number(object.from[1])}, 0], [${number(object.to[0])}, ${number(object.to[1])}, 0], color=${JSON.stringify(object.color)})`;
    }
    return `objects[${key}] = Circle(radius=${number(object.radius)}, color=${JSON.stringify(object.color)}).move_to([${number(object.center[0])}, ${number(object.center[1])}, 0])`;
  });
  const firstAnimationByObject = new Map<
    string,
    (typeof scene.animations)[number]
  >();
  for (const animation of scene.animations) {
    const current = firstAnimationByObject.get(animation.objectId);
    if (!current || animation.startMs < current.startMs) {
      firstAnimationByObject.set(animation.objectId, animation);
    }
  }
  const initialIds = scene.objects
    .map((object) => object.id)
    .filter((id) => {
      const first = firstAnimationByObject.get(id);
      return (
        !first ||
        (first.effect !== "appear" &&
          first.effect !== "fade-in" &&
          first.effect !== "draw")
      );
    });
  const animationLines = scene.animations.map((animation) => {
    const key = JSON.stringify(animation.objectId);
    const runtime = number(animation.durationMs / 1_000);
    let expression: string;
    switch (animation.effect) {
      case "appear":
      case "fade-in":
        expression = `FadeIn(objects[${key}], run_time=${runtime})`;
        break;
      case "fade-out":
        expression = `FadeOut(objects[${key}], run_time=${runtime})`;
        break;
      case "draw":
        expression = `Create(objects[${key}], run_time=${runtime})`;
        break;
      case "move":
        expression = `objects[${key}].animate(run_time=${runtime}).move_to([${number(animation.to![0])}, ${number(animation.to![1])}, 0])`;
        break;
    }
    return `Succession(Wait(${number(animation.startMs / 1_000)}), ${expression})`;
  });
  return [
    "from manim import AnimationGroup, Circle, Create, FadeIn, FadeOut, Line, Scene, Succession, Text, Wait",
    "",
    "class AvermateScene(Scene):",
    "    def construct(self):",
    `        self.camera.background_color = ${JSON.stringify(scene.background)}`,
    "        objects = {}",
    ...objectLines.map((line) => `        ${line}`),
    ...(initialIds.length > 0
      ? [`        self.add(${initialIds.map((id) => `objects[${JSON.stringify(id)}]`).join(", ")})`]
      : []),
    ...(animationLines.length > 0
      ? [
          "        animations = [",
          ...animationLines.map((line) => `            ${line},`),
          "        ]",
          "        self.play(AnimationGroup(*animations, lag_ratio=0))",
        ]
      : []),
    `        elapsed = ${number(Math.max(0, ...scene.animations.map((item) => item.startMs + item.durationMs)) / 1_000)}`,
    `        remaining = max(0, ${number(scene.durationMs / 1_000)} - elapsed)`,
    "        if remaining > 0:",
    "            self.wait(remaining)",
    "",
  ].join("\n");
}

export async function buildManim(
  manifest: ManimWorkerManifestV1,
  runner: CommandRunner = runCommand,
  root = "/workspace",
) {
  const python = renderManimPython(manifest.scene);
  if (new TextEncoder().encode(python).byteLength > 1024 * 1024) {
    throw new Error("MANIM_GENERATED_SOURCE_TOO_LARGE");
  }
  await writeFile(join(root, "tmp", "scene.py"), python, {
    flag: "wx",
    mode: 0o600,
  });
  const rendered = await runner(MANIM, manimArguments(manifest, root), {
    cwd: root,
    timeoutMs: 15 * 60_000,
    stdoutBytes: 1024 * 1024,
    stderrBytes: 4 * 1024 * 1024,
  });
  requireCommandSuccess(rendered, "manim-render");
  const mediaRoot = join(root, "tmp", "manim");
  const candidates = await findNamedFile(mediaRoot, "scene.mp4", 256);
  if (candidates.length !== 1) throw new Error("MANIM_OUTPUT_INVALID");
  const outputPath = join(root, "output", "scene.mp4");
  await copyFile(candidates[0]!, outputPath);
  const inspection = await runner(
    FFPROBE,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,avg_frame_rate:format=duration",
      "-of",
      "json",
      outputPath,
    ],
    { cwd: root, timeoutMs: 15_000, stdoutBytes: 256 * 1024 },
  );
  requireCommandSuccess(inspection, "manim-inspection");
  const probed = JSON.parse(inspection.stdout) as {
    streams?: Array<{ codec_name?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const stream = probed.streams?.[0];
  const durationMs = Math.round(Number(probed.format?.duration) * 1_000);
  if (
    stream?.codec_name !== "h264" ||
    stream.width !== manifest.width ||
    stream.height !== manifest.height ||
    !Number.isSafeInteger(durationMs) ||
    Math.abs(durationMs - manifest.scene.durationMs) > 1_000
  ) {
    throw new Error("MANIM_OUTPUT_PROPERTIES_INVALID");
  }
  return manimWorkerOutputV1Schema.parse({
    schemaVersion: 1,
    worker: "manim-build.v1",
    video: await outputFile(root, "output/scene.mp4", "video/mp4", 512 * 1024 * 1024),
    durationMs: manifest.scene.durationMs,
    width: manifest.width,
    height: manifest.height,
    fps: manifest.fps,
  });
}

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const cli = manimBuildCli(argv);
  await prepareWorkspace();
  const manifest = await readJsonManifest(cli.input, manimWorkerManifestV1Schema);
  const result = await buildManim(manifest);
  await writeJsonOutput(cli.manifest, result);
}

async function findNamedFile(
  root: string,
  targetName: string,
  maximumEntries: number,
): Promise<string[]> {
  const pending = [root];
  const matches: string[] = [];
  let visited = 0;
  while (pending.length > 0) {
    const directory = pending.shift()!;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      visited += 1;
      if (visited > maximumEntries) throw new Error("MANIM_OUTPUT_COUNT_EXCEEDED");
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("MANIM_OUTPUT_SYMLINK_REJECTED");
      if (entry.isDirectory()) pending.push(path);
      if (entry.isFile() && entry.name === targetName) {
        const info = await lstat(path);
        if (!info.isFile() || info.size < 12) throw new Error("MANIM_OUTPUT_INVALID");
        matches.push(path);
      }
    }
  }
  return matches;
}

function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error("MANIM_NUMBER_INVALID");
  return Object.is(value, -0) ? "0" : String(value);
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : "MANIM_BUILD_FAILED");
    process.exitCode = 1;
  });
}
