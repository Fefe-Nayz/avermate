import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { db } from "../db";
import {
  documentArtifacts,
  files,
  studyDocumentBuilds,
  studyDocuments,
  type LatexMetaV2,
} from "../db/schema";
import { NonRetryableJobError } from "../lib/jobs";
import { latexMetaSchema } from "../lib/study-document-content";
import { deleteFile, FILE_CONSTRAINTS, storeFile } from "../lib/storage";

export const BUILD_DOCUMENT_LATEX_JOB_KIND = "build.documentLatex";
export const LATEX_BUILD_TIMEOUT_MS = 30_000;
export const LATEX_BUILD_MAX_PAGES = 100;
export const LATEX_BUILD_MAX_SOURCE_BYTES = 512 * 1024;
export const LATEX_BUILD_MAX_LOG_BYTES = 64 * 1024;
export const LATEX_BUILD_RETAINED_ARTIFACTS = 3;

const PDF_MIME_TYPE = "application/pdf";
const payloadSchema = z.object({ buildId: z.string().min(1) }).strict();

export type LatexCompileResult =
  | {
      status: "succeeded";
      pdfBytes: Uint8Array;
      pageCount: number;
      log: string;
    }
  | { status: "failed"; log: string };

export interface LatexCompileInput {
  source: string;
  meta: LatexMetaV2;
  signal?: AbortSignal;
  timeoutMs: number;
  maxPages: number;
}

export type LatexCompiler = (
  input: LatexCompileInput,
) => Promise<LatexCompileResult>;

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

type TectonicEnvironment = Partial<
  Record<
    | "TECTONIC_BIN"
    | "TECTONIC_BUNDLE"
    | "TECTONIC_CACHE_DIR"
    | "TECTONIC_ONLY_CACHED",
    string | undefined
  >
>;

const LATEX_NATIVE_ENVIRONMENT_KEYS = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "LANG",
  "LC_ALL",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "FONTCONFIG_FILE",
  "FONTCONFIG_PATH",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "TECTONIC_CACHE_DIR",
] as const;

function enabledEnvironmentFlag(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

function processTectonicEnvironment(): TectonicEnvironment {
  return {
    TECTONIC_BIN: process.env.TECTONIC_BIN,
    TECTONIC_BUNDLE: process.env.TECTONIC_BUNDLE,
    TECTONIC_CACHE_DIR: process.env.TECTONIC_CACHE_DIR,
    TECTONIC_ONLY_CACHED: process.env.TECTONIC_ONLY_CACHED,
  };
}

/** Do not make API/database/provider credentials visible to native compilers. */
export function latexNativeEnvironment(
  environment: Record<string, string | undefined> = process.env,
) {
  const childEnvironment: Record<string, string> = {};
  for (const key of LATEX_NATIVE_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (value) childEnvironment[key] = value;
  }
  childEnvironment.TECTONIC_UNTRUSTED_MODE = "1";
  return childEnvironment;
}

/**
 * Tectonic resolves the files actually requested by TeX. This bounded parser
 * is deliberately diagnostic-only: it makes package use visible in build logs
 * without trying to implement TeX macro expansion or authorizing installs.
 */
export function declaredLatexPackages(source: string): string[] {
  const withoutComments = source
    .split(/\r?\n/)
    .map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "%") continue;
        let precedingSlashes = 0;
        for (
          let cursor = index - 1;
          cursor >= 0 && line[cursor] === "\\";
          cursor -= 1
        ) {
          precedingSlashes += 1;
        }
        if (precedingSlashes % 2 === 0) return line.slice(0, index);
      }
      return line;
    })
    .join("\n");
  const names = new Set<string>();
  const declaration =
    /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]{0,2048}\]\s*)?\{([^}]{1,2048})\}/g;
  for (const match of withoutComments.matchAll(declaration)) {
    for (const candidate of (match[1] ?? "").split(",")) {
      const name = candidate.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(name)) continue;
      names.add(name);
      if (names.size >= 100) return [...names];
    }
  }
  return [...names];
}

export function tectonicCompileCommand(
  entryPath: string,
  directory: string,
  environment: TectonicEnvironment = processTectonicEnvironment(),
) {
  const command = [
    environment.TECTONIC_BIN?.trim() || "tectonic",
    "--untrusted",
    "--keep-logs",
  ];
  const bundle = environment.TECTONIC_BUNDLE?.trim();
  if (bundle) command.push("--bundle", bundle);
  if (enabledEnvironmentFlag(environment.TECTONIC_ONLY_CACHED)) {
    command.push("--only-cached");
  }
  command.push("--outdir", directory, entryPath);
  return command;
}

function packageResolutionLog(
  source: string,
  environment: TectonicEnvironment,
) {
  const packages = declaredLatexPackages(source);
  return [
    packages.length > 0
      ? `Declared packages: ${packages.join(", ")}`
      : "Declared packages: none",
    `Package bundle: ${environment.TECTONIC_BUNDLE?.trim() ? "configured" : "Tectonic default"}; resolution: ${
      enabledEnvironmentFlag(environment.TECTONIC_ONLY_CACHED)
        ? "cache only"
        : "automatic with persistent cache"
    }`,
  ].join("\n");
}

function redactConfiguredBundle(
  value: string,
  environment: TectonicEnvironment,
) {
  const bundle = environment.TECTONIC_BUNDLE?.trim();
  return bundle
    ? value.replaceAll(bundle, "[configured Tectonic bundle]")
    : value;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function truncateLatexLog(value: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value.replaceAll("\0", ""));
  if (bytes.byteLength <= LATEX_BUILD_MAX_LOG_BYTES)
    return value.replaceAll("\0", "");
  return `${new TextDecoder().decode(
    bytes.subarray(0, LATEX_BUILD_MAX_LOG_BYTES),
  )}\n[compiler output truncated]`;
}

async function boundedText(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let retained = 0;
  let text = "";
  let truncated = false;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    const remaining = Math.max(0, maxBytes - retained);
    if (remaining > 0) {
      const kept = part.value.subarray(0, remaining);
      retained += kept.byteLength;
      text += decoder.decode(kept, { stream: true });
    }
    if (part.value.byteLength > remaining) truncated = true;
  }
  text += decoder.decode();
  return `${text.trim()}${truncated ? "\n[process output truncated]" : ""}`;
}

async function runCommand(
  command: string[],
  input: {
    cwd: string;
    timeoutMs: number;
    signal?: AbortSignal;
    environment?: Record<string, string>;
  },
): Promise<CommandResult> {
  input.signal?.throwIfAborted();
  const child = Bun.spawn(command, {
    cwd: input.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: input.environment ?? latexNativeEnvironment(),
  });
  let timedOut = false;
  // Compilation is an untrusted native workload, so abort and timeout must
  // terminate it even when the child does not handle SIGTERM.
  const stop = () => child.kill("SIGKILL");
  input.signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, input.timeoutMs);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      boundedText(child.stdout, LATEX_BUILD_MAX_LOG_BYTES),
      boundedText(child.stderr, LATEX_BUILD_MAX_LOG_BYTES),
    ]);
    input.signal?.throwIfAborted();
    return { exitCode, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", stop);
  }
}

function combinedLog(result: Pick<CommandResult, "stdout" | "stderr">) {
  return truncateLatexLog(
    [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
  );
}

async function optionalCompilerLog(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function failureLog(message: string, compilerLog = "") {
  return truncateLatexLog(
    [compilerLog.trim(), message.trim()].filter(Boolean).join("\n"),
  );
}

/**
 * Compile one in-memory source in an isolated temporary directory. Tectonic's
 * untrusted mode disables shell escape; native process and output limits bound
 * the remaining work. Tectonic implements the XeTeX path. Other declared
 * engines remain valid metadata for future workers but fail explicitly here,
 * rather than silently compiling with different semantics.
 */
export async function compileDocumentLatex(
  input: LatexCompileInput,
): Promise<LatexCompileResult> {
  const sourceBytes = new TextEncoder().encode(input.source);
  if (sourceBytes.byteLength > LATEX_BUILD_MAX_SOURCE_BYTES) {
    return {
      status: "failed",
      log: `LaTeX source exceeds the ${LATEX_BUILD_MAX_SOURCE_BYTES} byte limit`,
    };
  }
  const meta = latexMetaSchema.parse(input.meta);
  if (meta.engine !== "xelatex") {
    return {
      status: "failed",
      log: `${meta.engine} is not available on this server; the sandboxed Tectonic worker supports xelatex`,
    };
  }
  const entry = meta.entry ?? "main.tex";
  const directory = await mkdtemp(join(tmpdir(), "avermate-latex-"));
  const entryPath = join(directory, entry);
  const outputName = `${entry.slice(0, -4)}.pdf`;
  const outputPath = join(directory, outputName);
  const nativeLogPath = join(directory, `${entry.slice(0, -4)}.log`);
  const deadline = Date.now() + input.timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const environment = processTectonicEnvironment();

  try {
    await writeFile(entryPath, input.source, { encoding: "utf8", flag: "wx" });
    const compile = await runCommand(
      tectonicCompileCommand(entryPath, directory, environment),
      { cwd: directory, timeoutMs: remaining(), signal: input.signal },
    );
    const nativeLog = await optionalCompilerLog(nativeLogPath);
    const log = truncateLatexLog(
      redactConfiguredBundle(
        [
          `Requested engine: ${meta.engine}; compiler: Tectonic`,
          packageResolutionLog(input.source, environment),
          nativeLog,
          combinedLog(compile),
        ]
          .filter(Boolean)
          .join("\n"),
        environment,
      ),
    );
    if (compile.timedOut) {
      return {
        status: "failed",
        log: failureLog(
          `Tectonic exceeded the ${input.timeoutMs} ms build limit`,
          log,
        ),
      };
    }
    if (compile.exitCode !== 0) {
      return {
        status: "failed",
        log: failureLog(`Tectonic exited with status ${compile.exitCode}`, log),
      };
    }

    let outputInfo;
    try {
      outputInfo = await stat(outputPath);
    } catch {
      return {
        status: "failed",
        log: failureLog("Tectonic did not produce a PDF", log),
      };
    }
    if (
      outputInfo.size < 5 ||
      outputInfo.size > FILE_CONSTRAINTS["latex-build"].maxBytes
    ) {
      return {
        status: "failed",
        log: failureLog("The generated PDF has an invalid size", log),
      };
    }

    const pdfInfo = await runCommand(
      [process.env.PDFINFO_BIN?.trim() || "pdfinfo", outputPath],
      { cwd: directory, timeoutMs: remaining(), signal: input.signal },
    );
    if (pdfInfo.timedOut || pdfInfo.exitCode !== 0) {
      return {
        status: "failed",
        log: failureLog(
          pdfInfo.timedOut
            ? "PDF inspection exceeded the build time limit"
            : pdfInfo.stderr || "The generated PDF could not be inspected",
          log,
        ),
      };
    }
    const pageMatch = /^Pages:\s*(\d+)\s*$/im.exec(pdfInfo.stdout);
    const pageCount = pageMatch ? Number(pageMatch[1]) : Number.NaN;
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
      return {
        status: "failed",
        log: failureLog("The generated PDF page count is invalid", log),
      };
    }
    if (pageCount > input.maxPages) {
      return {
        status: "failed",
        log: failureLog(
          `The generated PDF has ${pageCount} pages; the limit is ${input.maxPages}`,
          log,
        ),
      };
    }

    const pdfBytes = new Uint8Array(await readFile(outputPath));
    if (new TextDecoder("ascii").decode(pdfBytes.subarray(0, 5)) !== "%PDF-") {
      return {
        status: "failed",
        log: failureLog("Tectonic produced an invalid PDF", log),
      };
    }
    return { status: "succeeded", pdfBytes, pageCount, log };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function buildWithDocument(buildId: string) {
  const [row] = await db
    .select({ build: studyDocumentBuilds, document: studyDocuments })
    .from(studyDocumentBuilds)
    .innerJoin(
      studyDocuments,
      eq(studyDocuments.id, studyDocumentBuilds.documentId),
    )
    .where(eq(studyDocumentBuilds.id, buildId))
    .limit(1);
  return row ?? null;
}

async function setLatexArtifact(
  build: typeof studyDocumentBuilds.$inferSelect,
  status: "queued" | "running" | "succeeded" | "failed",
  input: { fileId?: string | null; log?: string | null } = {},
) {
  await db
    .insert(documentArtifacts)
    .values({
      documentId: build.documentId,
      kind: "pdf",
      variant: "default",
      sourceRevision: build.revision,
      status,
      fileId: input.fileId ?? null,
      log: input.log ?? null,
      userId: build.userId,
    })
    .onConflictDoUpdate({
      target: [
        documentArtifacts.documentId,
        documentArtifacts.kind,
        documentArtifacts.variant,
        documentArtifacts.sourceRevision,
      ],
      set: {
        status,
        fileId: input.fileId ?? null,
        log: input.log ?? null,
        updatedAt: new Date(),
      },
    });
}

async function publishFailure(
  build: typeof studyDocumentBuilds.$inferSelect,
  log: string,
) {
  const safeLog = truncateLatexLog(log);
  const [failed] = await db
    .update(studyDocumentBuilds)
    .set({
      status: "failed",
      pdfFileId: null,
      log: safeLog,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(studyDocumentBuilds.id, build.id),
        eq(studyDocumentBuilds.userId, build.userId),
        inArray(studyDocumentBuilds.status, ["queued", "running"]),
      ),
    )
    .returning();
  const result = failed ?? build;
  await setLatexArtifact(result, "failed", { log: safeLog });
  return result;
}

async function requeueAfterInfrastructureFailure(
  build: typeof studyDocumentBuilds.$inferSelect,
  log: string,
) {
  const safeLog = truncateLatexLog(log);
  await db
    .update(studyDocumentBuilds)
    .set({
      status: "queued",
      pdfFileId: null,
      log: safeLog,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(studyDocumentBuilds.id, build.id),
        eq(studyDocumentBuilds.userId, build.userId),
        inArray(studyDocumentBuilds.status, ["queued", "running"]),
        isNull(studyDocumentBuilds.pdfFileId),
      ),
    );
  await setLatexArtifact(build, "queued", { log: safeLog });
}

async function cleanupCandidate(
  userId: string,
  fileId: string,
  remove: typeof deleteFile,
) {
  await remove(userId, fileId).catch(() => undefined);
}

/**
 * Keep the current artifact plus the newest neighbouring revisions. Build/log
 * rows remain as history; only their reclaimable PDF ownership edge is cut.
 */
export async function pruneLatexBuildArtifacts(
  input: {
    userId: string;
    documentId: string;
    currentBuildId: string;
    retainedArtifacts?: number;
  },
  options: { removeFile?: typeof deleteFile } = {},
) {
  const retainedArtifacts = Math.max(
    1,
    input.retainedArtifacts ?? LATEX_BUILD_RETAINED_ARTIFACTS,
  );
  const builds = await db
    .select({
      id: studyDocumentBuilds.id,
      pdfFileId: studyDocumentBuilds.pdfFileId,
    })
    .from(studyDocumentBuilds)
    .where(
      and(
        eq(studyDocumentBuilds.userId, input.userId),
        eq(studyDocumentBuilds.documentId, input.documentId),
        eq(studyDocumentBuilds.status, "succeeded"),
        isNotNull(studyDocumentBuilds.pdfFileId),
      ),
    )
    .orderBy(
      desc(studyDocumentBuilds.revision),
      desc(studyDocumentBuilds.createdAt),
    );
  const retained = new Set([input.currentBuildId]);
  for (const build of builds) {
    if (retained.size >= retainedArtifacts) break;
    retained.add(build.id);
  }
  let reclaimed = 0;
  for (const build of builds) {
    if (retained.has(build.id) || !build.pdfFileId) continue;
    const [detached] = await db
      .update(studyDocumentBuilds)
      .set({ pdfFileId: null, updatedAt: new Date() })
      .where(
        and(
          eq(studyDocumentBuilds.id, build.id),
          eq(studyDocumentBuilds.userId, input.userId),
          eq(studyDocumentBuilds.pdfFileId, build.pdfFileId),
        ),
      )
      .returning({ id: studyDocumentBuilds.id });
    if (!detached) continue;
    // The generic artifact ledger is the canonical download surface. Once a
    // retained LaTeX file is reclaimed it must not keep advertising a
    // succeeded artifact whose file has been marked deleted.
    await db
      .delete(documentArtifacts)
      .where(
        and(
          eq(documentArtifacts.documentId, input.documentId),
          eq(documentArtifacts.userId, input.userId),
          eq(documentArtifacts.kind, "pdf"),
          eq(documentArtifacts.fileId, build.pdfFileId),
        ),
      );
    reclaimed += 1;
    await cleanupCandidate(
      input.userId,
      build.pdfFileId,
      options.removeFile ?? deleteFile,
    );
  }
  return { reclaimed, retained: retained.size };
}

async function pruneLatexBuildArtifactsAfterSuccess(
  input: Parameters<typeof pruneLatexBuildArtifacts>[0],
  removeFile: typeof deleteFile,
) {
  try {
    await pruneLatexBuildArtifacts(input, { removeFile });
  } catch (error) {
    // The build is already durable. A later build or the storage reaper can
    // retry reclamation; retention failure must not falsify compiler success.
    console.error("[latex] artifact retention failed", error);
  }
}

export async function runBuildDocumentLatexJob(
  payload: unknown,
  options: {
    signal?: AbortSignal;
    compileLatex?: LatexCompiler;
    storeFile?: typeof storeFile;
    deleteFile?: typeof deleteFile;
    afterAdopt?: () => Promise<void>;
    /** Current durable queue attempt; omitted direct calls are terminal. */
    attempt?: number;
    maxAttempts?: number;
  } = {},
) {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new NonRetryableJobError("Invalid build.documentLatex job payload", {
      cause: parsed.error,
    });
  }
  let row = await buildWithDocument(parsed.data.buildId);
  if (!row) throw new NonRetryableJobError("LaTeX build not found");
  const { build, document } = row;
  if (build.userId !== document.userId) {
    throw new NonRetryableJobError("LaTeX build ownership is inconsistent");
  }
  await setLatexArtifact(build, build.status, {
    fileId: build.pdfFileId,
    log: build.log,
  });
  if (build.status === "succeeded") {
    if (!build.pdfFileId)
      return {
        buildId: build.id,
        revision: build.revision,
        status: "succeeded" as const,
      };
    return {
      buildId: build.id,
      pdfFileId: build.pdfFileId,
      revision: build.revision,
      status: "succeeded" as const,
    };
  }
  if (build.status === "failed") {
    return {
      buildId: build.id,
      revision: build.revision,
      status: "failed" as const,
    };
  }
  if (build.status === "queued") {
    const [claimed] = await db
      .update(studyDocumentBuilds)
      .set({ status: "running", log: null, updatedAt: new Date() })
      .where(
        and(
          eq(studyDocumentBuilds.id, build.id),
          eq(studyDocumentBuilds.userId, build.userId),
          eq(studyDocumentBuilds.status, "queued"),
        ),
      )
      .returning();
    if (!claimed) {
      row = await buildWithDocument(build.id);
      if (!row) throw new NonRetryableJobError("LaTeX build disappeared");
      if (row.build.status === "succeeded" && row.build.pdfFileId) {
        return {
          buildId: row.build.id,
          pdfFileId: row.build.pdfFileId,
          revision: row.build.revision,
          status: "succeeded" as const,
        };
      }
      if (row.build.status === "failed") {
        return {
          buildId: row.build.id,
          revision: row.build.revision,
          status: "failed" as const,
        };
      }
    } else {
      await setLatexArtifact(claimed, "running");
    }
  }

  if (
    document.kind !== "latex" ||
    document.revision !== build.revision ||
    document.metaVersion !== 2
  ) {
    const failed = await publishFailure(
      build,
      document.kind !== "latex"
        ? "Only LaTeX study documents can be built"
        : "The source revision changed before this build started",
    );
    return {
      buildId: failed.id,
      revision: failed.revision,
      status: "failed" as const,
    };
  }
  const meta = latexMetaSchema.safeParse(document.metaJson);
  if (!meta.success) {
    const failed = await publishFailure(
      build,
      meta.error.issues[0]?.message ?? "Invalid LaTeX build metadata",
    );
    return {
      buildId: failed.id,
      revision: failed.revision,
      status: "failed" as const,
    };
  }

  let candidateId: string | null = null;
  try {
    options.signal?.throwIfAborted();
    const compiled = await (options.compileLatex ?? compileDocumentLatex)({
      source: document.bodyMarkdown,
      meta: meta.data,
      signal: options.signal,
      timeoutMs: LATEX_BUILD_TIMEOUT_MS,
      maxPages: LATEX_BUILD_MAX_PAGES,
    });
    if (compiled.status === "failed") {
      const failed = await publishFailure(build, compiled.log);
      return {
        buildId: failed.id,
        revision: failed.revision,
        status: "failed" as const,
      };
    }
    if (
      compiled.pageCount < 1 ||
      compiled.pageCount > LATEX_BUILD_MAX_PAGES ||
      compiled.pdfBytes.byteLength < 5 ||
      compiled.pdfBytes.byteLength > FILE_CONSTRAINTS["latex-build"].maxBytes
    ) {
      const failed = await publishFailure(
        build,
        failureLog(
          "The compiler returned an invalid or oversized PDF",
          compiled.log,
        ),
      );
      return {
        buildId: failed.id,
        revision: failed.revision,
        status: "failed" as const,
      };
    }
    const header = new TextDecoder("ascii").decode(
      compiled.pdfBytes.subarray(0, 5),
    );
    if (header !== "%PDF-") {
      const failed = await publishFailure(
        build,
        failureLog("The compiler did not return a PDF", compiled.log),
      );
      return {
        buildId: failed.id,
        revision: failed.revision,
        status: "failed" as const,
      };
    }

    const stored = await (options.storeFile ?? storeFile)({
      userId: document.userId,
      purpose: "latex-build",
      file: new File(
        [exactArrayBuffer(compiled.pdfBytes)],
        `${document.id}-r${document.revision}.pdf`,
        { type: PDF_MIME_TYPE },
      ),
      nameHint: `${document.id}-r${document.revision}.pdf`,
    });
    candidateId = stored.id;
    const [adopted] = await db
      .update(studyDocumentBuilds)
      .set({
        status: "succeeded",
        pdfFileId: stored.id,
        log: truncateLatexLog(compiled.log),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(studyDocumentBuilds.id, build.id),
          eq(studyDocumentBuilds.userId, build.userId),
          eq(studyDocumentBuilds.status, "running"),
          isNull(studyDocumentBuilds.pdfFileId),
        ),
      )
      .returning({ pdfFileId: studyDocumentBuilds.pdfFileId });
    await options.afterAdopt?.();
    if (adopted?.pdfFileId === stored.id) {
      await setLatexArtifact(build, "succeeded", {
        fileId: stored.id,
        log: truncateLatexLog(compiled.log),
      });
      candidateId = null;
      await pruneLatexBuildArtifactsAfterSuccess(
        {
          userId: document.userId,
          documentId: document.id,
          currentBuildId: build.id,
        },
        options.deleteFile ?? deleteFile,
      );
      return {
        buildId: build.id,
        pdfFileId: stored.id,
        revision: build.revision,
        pageCount: compiled.pageCount,
        status: "succeeded" as const,
      };
    }

    const current = await buildWithDocument(build.id);
    if (current?.build.status === "succeeded" && current.build.pdfFileId) {
      await setLatexArtifact(current.build, "succeeded", {
        fileId: current.build.pdfFileId,
        log: current.build.log,
      });
      await cleanupCandidate(
        document.userId,
        stored.id,
        options.deleteFile ?? deleteFile,
      );
      candidateId = null;
      return {
        buildId: build.id,
        pdfFileId: current.build.pdfFileId,
        revision: build.revision,
        status: "succeeded" as const,
      };
    }
    throw new Error("The generated LaTeX PDF could not be adopted");
  } catch (error) {
    if (candidateId) {
      const current = await buildWithDocument(build.id);
      if (current?.build.pdfFileId === candidateId) {
        const adoptedId = candidateId;
        candidateId = null;
        await setLatexArtifact(current.build, "succeeded", {
          fileId: adoptedId,
          log: current.build.log,
        });
        await pruneLatexBuildArtifactsAfterSuccess(
          {
            userId: document.userId,
            documentId: document.id,
            currentBuildId: build.id,
          },
          options.deleteFile ?? deleteFile,
        );
        return {
          buildId: build.id,
          pdfFileId: adoptedId,
          revision: build.revision,
          status: "succeeded" as const,
        };
      }
      await cleanupCandidate(
        document.userId,
        candidateId,
        options.deleteFile ?? deleteFile,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    const attempt = options.attempt ?? 1;
    const maxAttempts = options.maxAttempts ?? 1;
    if (attempt < maxAttempts) {
      await requeueAfterInfrastructureFailure(build, message);
      throw error;
    }
    const failed = await publishFailure(build, message);
    return {
      buildId: failed.id,
      revision: failed.revision,
      status: "failed" as const,
    };
  }
}
