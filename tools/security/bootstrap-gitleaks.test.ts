import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  assertPinnedVersion,
  GITLEAKS_VERSION,
  parseChecksums,
  requireArtifactChecksum,
  resolveArtifact,
  SUPPORTED_ARTIFACTS,
  verifyArchiveChecksum,
} from "./bootstrap-gitleaks";

describe("pinned Gitleaks bootstrap metadata", () => {
  test("pins v8.24.3 and has a checksum for every supported artifact", async () => {
    const contents = await readFile(
      path.join(import.meta.dir, "gitleaks-checksums.txt"),
      "utf8",
    );
    const checksums = parseChecksums(contents);

    expect(GITLEAKS_VERSION).toBe("8.24.3");
    for (const artifact of Object.values(SUPPORTED_ARTIFACTS)) {
      expect(checksums.get(artifact)).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(checksums.get("gitleaks_8.24.3_windows_x64.zip")).toBe(
      "3f1a35578631dbfe633cc5b49e6c906e55ff14a4bfd7336a10fb27fe33b6dcd2",
    );
  });

  test("refuses latest, a different version, malformed metadata and fallbacks", () => {
    expect(() => assertPinnedVersion("latest")).toThrow();
    expect(() => assertPinnedVersion("8.24.2")).toThrow();
    expect(() => parseChecksums("# no checksums\n")).toThrow();
    expect(() => parseChecksums("not-a-checksum  artifact")).toThrow();
    expect(() =>
      requireArtifactChecksum(new Map(), "gitleaks_8.24.3_linux_x64.tar.gz"),
    ).toThrow();
    expect(() =>
      verifyArchiveChecksum(
        new TextEncoder().encode("tampered"),
        "0".repeat(64),
      ),
    ).toThrow();
    expect(() => resolveArtifact("win32", "arm64")).toThrow();
  });

  test("keeps false-positive allowances semantic instead of excluding paths", async () => {
    const config = await readFile(
      path.join(import.meta.dir, "gitleaks.toml"),
      "utf8",
    );
    expect(config).not.toMatch(/^\s*(?:paths|commits)\s*=/m);
    expect(config).not.toContain(".*");
    expect(config).toContain("idempotencyKey");
    expect(config).toContain("checksum");
  });
});
