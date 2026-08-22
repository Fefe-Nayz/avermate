import { rm } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { basename, dirname, resolve } from "node:path"
import { tmpdir } from "node:os"

const target = resolve(process.argv[2] ?? "")
const temporaryRoot = resolve(tmpdir())

if (
  dirname(target) !== temporaryRoot ||
  !basename(target).startsWith("avermate-assistant-e2e-")
) {
  throw new Error("Refusing to clean an unexpected Playwright data path")
}

for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    await rm(target, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: 100,
    })
    process.exit(0)
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : undefined
    if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") {
      throw error
    }
    await delay(250)
  }
}

throw new Error("Timed out while cleaning the Playwright data path")
