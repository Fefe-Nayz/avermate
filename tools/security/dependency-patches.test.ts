import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dir, "../..");

function runImageSizeProbe(source: string) {
  return spawnSync(process.execPath, ["-e", source], {
    cwd: workspaceRoot,
    encoding: "utf8",
    timeout: 2_000,
  });
}

describe("security-patched transitive dependencies", () => {
  test("rejects zero-length ICNS entries without blocking the process", () => {
    const probe = runImageSizeProbe(`
      const imageSize = require("image-size");
      const input = Buffer.alloc(16);
      input.write("icns", 0, "ascii");
      input.writeUInt32BE(16, 4);
      input.write("ic07", 8, "ascii");
      input.writeUInt32BE(0, 12);
      try { imageSize(input); } catch { process.stdout.write("rejected"); }
    `);

    expect(probe.error).toBeUndefined();
    expect(probe.signal).toBeNull();
    expect(probe.status).toBe(0);
    expect(probe.stdout).toBe("rejected");
  });

  test("rejects a zero-length JXL partial-stream box without looping", () => {
    const probe = runImageSizeProbe(`
      const imageSize = require("image-size");
      const input = Buffer.alloc(32);
      input.writeUInt32BE(12, 0);
      input.write("JXL ", 4, "ascii");
      input.writeUInt32BE(12, 12);
      input.write("ftyp", 16, "ascii");
      input.write("jxl ", 20, "ascii");
      input.writeUInt32BE(0, 24);
      input.write("jxlp", 28, "ascii");
      try { imageSize(input); } catch { process.stdout.write("rejected"); }
    `);

    expect(probe.error).toBeUndefined();
    expect(probe.signal).toBeNull();
    expect(probe.status).toBe(0);
    expect(probe.stdout).toBe("rejected");
  });

  test("keeps the vendored patch explicit until upstream publishes a fix", async () => {
    const patch = await Bun.file(
      resolve(workspaceRoot, "patches/image-size@1.2.1.patch"),
    ).text();

    expect(patch).toContain("if (boxSize < 8)");
    expect(patch).toContain("Invalid ICNS image entry length");
  });
});
