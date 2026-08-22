import { resolve } from "node:path";
import { run033, workspaceRoot } from "./plan-033-lib";

await run033(
  "required advanced-media profiles have fresh live provider evidence",
  [
    "bun",
    "run",
    "sandbox:conformance",
    "--",
    "--require-live",
    "--profile",
    "web-render.v1",
    "--profile",
    "video-audio-extract.v1",
    "--profile",
    "ffmpeg-render.v1",
  ],
  { cwd: resolve(workspaceRoot, "apps/server") },
);
