import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { collectWorkspaceCandidates } from "./candidates";
import { inspectCandidate } from "./personal-data";

interface FixtureManifest {
  database: { extension: string; payload: string; stem: string };
  personalPath: { drive: string; fileName: string; segments: string[] };
  syntheticSecret: {
    fileName: string;
    fillCharacter: string;
    fillLength: number;
    prefixParts: string[];
    separator: string;
  };
}

const roots: string[] = [];
// SAFETY: the checked-in manifest is owned by this test and its shape is
// exercised immediately by every fixture materializer below.
const manifest = JSON.parse(
  await readFile(path.join(import.meta.dir, "fixtures", "cases.json"), "utf8"),
) as FixtureManifest;

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "avermate-security-test-"));
  roots.push(root);
  return root;
}

async function runGit(root: string, ...args: string[]): Promise<void> {
  const process = Bun.spawn(["git", ...args], {
    cwd: root,
    stdout: "ignore",
    stderr: "ignore",
  });
  if ((await process.exited) !== 0) throw new Error("Git test setup failed.");
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}, 30_000);

describe("personal-data release policy", () => {
  test("rejects a generated synthetic secret without committing its value", async () => {
    const root = await temporaryRoot();
    const spec = manifest.syntheticSecret;
    const prefix = spec.prefixParts.join(spec.separator);
    const value = `${prefix}${spec.separator}${spec.fillCharacter.repeat(spec.fillLength)}`;
    await writeFile(path.join(root, spec.fileName), `API_KEY=${value}\n`);

    const findings = await inspectCandidate(root, spec.fileName, {
      identifierHashes: new Set(),
    });
    expect(findings.map((item) => item.rule)).toContain("secret-openai");
  });

  test("rejects a fake absolute developer-home path", async () => {
    const root = await temporaryRoot();
    const spec = manifest.personalPath;
    const personalPath = path.win32.join(`${spec.drive}\\`, ...spec.segments);
    await writeFile(path.join(root, spec.fileName), `${personalPath}\n`);

    const findings = await inspectCandidate(root, spec.fileName, {
      identifierHashes: new Set(),
    });
    expect(findings.map((item) => item.rule)).toContain(
      "absolute-developer-home",
    );
  });

  test("rejects a fake database before reading its contents", async () => {
    const root = await temporaryRoot();
    const spec = manifest.database;
    const fileName = `${spec.stem}${spec.extension}`;
    await writeFile(path.join(root, fileName), spec.payload);

    const findings = await inspectCandidate(root, fileName, {
      identifierHashes: new Set(),
    });
    expect(findings.map((item) => item.rule)).toContain("database-file");
  });

  test("allows the reviewed empty .env.example fixture", async () => {
    const root = path.join(import.meta.dir, "fixtures", "allowed");
    expect(
      await inspectCandidate(root, ".env.example", {
        identifierHashes: new Set(),
      }),
    ).toEqual([]);
  });

  test(
    "Git candidate discovery excludes ignored secrets and local data",
    async () => {
      const root = await temporaryRoot();
      await runGit(root, "init", "--quiet");
      await runGit(root, "config", "user.email", "security@example.test");
      await runGit(root, "config", "user.name", "Security Fixture");
      await writeFile(path.join(root, ".gitignore"), ".env\n.data/\n");
      await writeFile(
        path.join(root, "tracked.ts"),
        "export const initial = true;\n",
      );
      await runGit(root, "add", ".gitignore", "tracked.ts");
      await runGit(root, "commit", "--quiet", "-m", "fixture baseline");

      await writeFile(
        path.join(root, "tracked.ts"),
        "export const changed = true;\n",
      );
      await writeFile(
        path.join(root, "staged.ts"),
        "export const staged = true;\n",
      );
      await writeFile(path.join(root, "candidate.txt"), "safe candidate\n");
      await runGit(root, "add", "staged.ts");

      const secretSpec = manifest.syntheticSecret;
      const ignoredValue = `${secretSpec.prefixParts.join(secretSpec.separator)}${secretSpec.separator}${secretSpec.fillCharacter.repeat(secretSpec.fillLength)}`;
      await writeFile(path.join(root, ".env"), `API_KEY=${ignoredValue}\n`);
      await mkdir(path.join(root, ".data"), { recursive: true });
      await writeFile(
        path.join(root, ".data", "private-upload.pdf"),
        ignoredValue,
      );

      expect(await collectWorkspaceCandidates({ root })).toEqual([
        "candidate.txt",
        "staged.ts",
        "tracked.ts",
      ]);
    },
    30_000,
  );
});
