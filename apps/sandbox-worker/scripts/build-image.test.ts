import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkerImageBuildPlan,
  digestFiles,
  parseBuildImageCli,
} from "./build-image";

const roots: string[] = [];
const pinned = `registry.example/toolchain@sha256:${"a".repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("sandbox worker image plan", () => {
  test("requires exact digest-pinned bases and never accepts extra Docker flags", () => {
    expect(() =>
      parseBuildImageCli([
        "--profile",
        "media",
        "--profile-version",
        "v1",
        "--builder-base",
        "oven/bun:1.4.0",
        "--runtime-base",
        pinned,
        "--tag",
        "avermate/media:v1",
      ]),
    ).toThrow("WORKER_IMAGE_BASE_NOT_PINNED");
    expect(() =>
      parseBuildImageCli([
        "--profile",
        "media",
        "--profile-version",
        "v1",
        "--builder-base",
        pinned,
        "--runtime-base",
        pinned,
        "--tag",
        "avermate/media:v1",
        "--build-arg",
        "ATTACK=1",
      ]),
    ).toThrow("WORKER_IMAGE_ARGUMENTS_INVALID");
  });

  test("constructs an argv-only Docker plan bound to the source digest", async () => {
    const workspaceRoot = join(import.meta.dir, "../../..");
    const input = parseBuildImageCli([
      "--profile",
      "browser",
      "--profile-version",
      "browser-v1",
      "--builder-base",
      pinned,
      "--runtime-base",
      `registry.example/browser@sha256:${"b".repeat(64)}`,
      "--tag",
      "avermate/browser:browser-v1",
    ]);
    const plan = await createWorkerImageBuildPlan(input, workspaceRoot);
    expect(plan.buildInputDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(plan.command[0]).toBe("docker");
    expect(plan.command).toContain(`BUILD_INPUT_DIGEST=${plan.buildInputDigest}`);
    expect(plan.command).not.toContain("sh");
    expect(plan.execute).toBe(false);
    expect(
      parseBuildImageCli([
        "--profile",
        "video-audio",
        "--profile-version",
        "video-audio-v1",
        "--builder-base",
        pinned,
        "--runtime-base",
        pinned,
        "--tag",
        "avermate/video-audio:v1",
      ]).profile,
    ).toBe("video-audio");
    for (const profile of ["ocr", "speech-to-text"] as const) {
      const local = parseBuildImageCli([
        "--profile",
        profile,
        "--profile-version",
        `${profile}-v1`,
        "--builder-base",
        pinned,
        "--runtime-base",
        pinned,
        "--tag",
        `avermate/${profile}:v1`,
      ]);
      expect(local.profile).toBe(profile);
      expect(
        (await createWorkerImageBuildPlan(local, workspaceRoot)).command,
      ).toContain(`WORKER_PROFILE=${profile}`);
    }
    expect(() =>
      parseBuildImageCli([
        "--profile",
        "speech-to-text-dev",
        "--profile-version",
        "speech-to-text-v1",
        "--builder-base",
        pinned,
        "--runtime-base",
        pinned,
        "--tag",
        "avermate/speech-to-text:v1",
      ]),
    ).toThrow("WORKER_IMAGE_PROFILE_INVALID");
  });

  test("hashes paths and bytes deterministically and rejects traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-worker-digest-"));
    roots.push(root);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
    await writeFile(join(root, "src", "b.ts"), "export const b = 2;\n");
    const first = await digestFiles(root, ["src/b.ts", "src/a.ts"]);
    const second = await digestFiles(root, ["src/a.ts", "src/b.ts"]);
    expect(first).toBe(second);
    await expect(digestFiles(root, ["../outside"])).rejects.toThrow(
      "WORKER_IMAGE_INPUT_PATH_INVALID",
    );
  });
});
