import { defineConfig, devices } from "@playwright/test"
import { join } from "node:path"
import { tmpdir } from "node:os"

// Playwright evaluates this config again inside each worker process. Reuse the
// coordinator's root there or workers would look for fixtures under their own
// PID while the web servers use the original disposable database.
const assistantE2eRoot =
  process.env.AVERMATE_ASSISTANT_E2E_ROOT ??
  join(tmpdir(), `avermate-assistant-e2e-${process.pid}`)
process.env.AVERMATE_ASSISTANT_E2E_ROOT = assistantE2eRoot
const usePrebuiltWeb = process.env.AVERMATE_E2E_PREBUILT === "1"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "line",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command:
        "bun -e \"require('node:fs').mkdirSync(process.env.AVERMATE_ASSISTANT_E2E_ROOT,{recursive:true})\" && bun run --cwd ../server db:migrate && bun run --cwd ../server scripts/seed-demo.ts --full --email assistant-e2e@example.com --password assistant-e2e-password && bun e2e/seed-production-surfaces.ts && bun run --cwd ../server start",
      url: "http://localhost:5100/health",
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        AVERMATE_ASSISTANT_E2E_ROOT: assistantE2eRoot,
        DATABASE_URL: `file:${join(assistantE2eRoot, "assistant-e2e.db").replaceAll("\\", "/")}`,
        BETTER_AUTH_URL: "http://localhost:5100",
        BETTER_AUTH_SECRET: "assistant-e2e-only-secret-32-characters-minimum",
        CLIENT_URL: "http://localhost:3100",
        PORT: "5100",
        NODE_ENV: "test",
        STORAGE_DRIVER: "local",
        LOCAL_UPLOAD_DIR: join(assistantE2eRoot, "uploads"),
        DISABLE_EMAIL: "true",
        DISABLE_UPLOADS: "false",
        DISABLE_JOBS: "true",
        DISABLE_OCR: "true",
        DISABLE_TRANSCRIPTION: "true",
        DISABLE_TTS: "true",
      },
    },
    {
      command: usePrebuiltWeb
        ? "bunx next start --hostname 0.0.0.0 --port 3100"
        : "bun scripts/sync-pyodide-assets.ts && bun run build && bunx next start --hostname 0.0.0.0 --port 3100",
      url: "http://localhost:3100/auth/sign-in",
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_URL: "http://localhost:5100",
        NEXT_PUBLIC_APP_URL: "http://localhost:3100",
        API_INTERNAL_URL: "http://localhost:5100",
      },
    },
  ],
})
