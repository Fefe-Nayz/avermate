import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { basename, dirname, resolve } from "node:path"
import { tmpdir } from "node:os"

export default async function globalTeardown() {
  const configured = process.env.AVERMATE_ASSISTANT_E2E_ROOT
  if (!configured) return
  const target = resolve(configured)
  const temporaryRoot = resolve(tmpdir())
  if (
    dirname(target) !== temporaryRoot ||
    !basename(target).startsWith("avermate-assistant-e2e-")
  ) {
    throw new Error("Refusing to clean an unexpected Playwright data path")
  }
  // Playwright stops configured web servers after global teardown. On Windows,
  // SQLite therefore still holds the database open here. Hand cleanup to a
  // detached helper which retries after the server process has exited.
  const cleanupScript = fileURLToPath(
    new URL("./deferred-cleanup.mjs", import.meta.url)
  )
  const child = spawn(process.execPath, [cleanupScript, target], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
  child.unref()
}
