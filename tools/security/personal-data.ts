import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { collectWorkspaceCandidates } from "./candidates";

const IDENTIFIER_HASHES = path.join(
  import.meta.dir,
  "known-production-identifiers.sha256",
);
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_BINARY_FIXTURE_BYTES = 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;

const SECRET_PATTERNS: Array<[rule: string, pattern: RegExp]> = [
  ["secret-openai", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g],
  [
    "secret-github",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  ],
  ["secret-aws", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  [
    "private-key-content",
    /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  ],
];

const CONSUMER_EMAIL_DOMAINS = new Set([
  "free.fr",
  "gmail.com",
  "hotmail.com",
  "icloud.com",
  "laposte.net",
  "live.com",
  "orange.fr",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "wanadoo.fr",
  "yahoo.com",
  "yahoo.fr",
]);

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".avi",
  ".bin",
  ".doc",
  ".docx",
  ".epub",
  ".exe",
  ".flac",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".rar",
  ".tar",
  ".wasm",
  ".wav",
  ".webm",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip",
]);

export interface PersonalDataFinding {
  file: string;
  rule: string;
  line?: number;
}

interface InspectOptions {
  candidateSet?: ReadonlySet<string>;
  identifierHashes?: ReadonlySet<string>;
}

function finding(
  file: string,
  rule: string,
  line?: number,
): PersonalDataFinding {
  const result: PersonalDataFinding = { file, rule };
  if (line) result.line = line;
  return result;
}

function lineNumber(contents: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (contents.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function pathFindings(relativePath: string): PersonalDataFinding[] {
  const normalized = relativePath.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  const basename = path.posix.basename(lower);
  const segments = lower.split("/");
  const extension = path.posix.extname(basename);
  const findings: PersonalDataFinding[] = [];

  if (
    (basename === ".env" ||
      basename === ".envrc" ||
      basename.startsWith(".env.")) &&
    basename !== ".env.example"
  ) {
    findings.push(finding(normalized, "forbidden-env-file"));
  }

  if (
    [".key", ".p12", ".pem", ".pfx"].includes(extension) ||
    /^(?:id_rsa|id_ed25519)(?:\.|$)/.test(basename)
  ) {
    findings.push(finding(normalized, "private-key-file"));
  }

  if (
    /(?:^|\.)db(?:$|[-.])/.test(basename) ||
    /\.(?:sqlite|sqlite3)(?:$|[-.])/.test(basename) ||
    /\.db\.bak/.test(basename)
  ) {
    findings.push(finding(normalized, "database-file"));
  }

  if (
    /^(?:cookies?|cookie-jar)(?:\.|$)/.test(basename) ||
    /(?:token|oauth|provider|challenge)[-_]?(?:dump|payload|response)/.test(
      basename,
    )
  ) {
    findings.push(finding(normalized, "credential-dump"));
  }

  if (
    segments.some((segment) =>
      [".data", "buckets", "uploads"].includes(segment),
    )
  ) {
    findings.push(finding(normalized, "local-storage-data"));
  }

  const generatedSegment = segments.some((segment) =>
    [
      "generated-artifacts",
      "ocr-output",
      "ocr-outputs",
      "private-storage",
      "storage-bucket",
    ].includes(segment),
  );
  const capturedMedia =
    segments.some((segment) => ["recording", "recordings"].includes(segment)) &&
    BINARY_EXTENSIONS.has(extension);
  const exportedConversation =
    /\.(?:har|jsonl)$/.test(basename) &&
    (segments.some((segment) =>
      ["chat", "chats", "conversation", "conversations", "exports"].includes(
        segment,
      ),
    ) ||
      /(?:chat|conversation|export)/.test(basename));
  if (generatedSegment || capturedMedia || exportedConversation) {
    findings.push(finding(normalized, "generated-user-artifact"));
  }

  return findings;
}

function isReservedEmailDomain(domain: string): boolean {
  return (
    domain === "localhost" ||
    domain === "avermate.fr" ||
    domain === "example.com" ||
    domain === "example.net" ||
    domain === "example.org" ||
    domain.endsWith(".example") ||
    domain.endsWith(".test")
  );
}

function contentFindings(
  relativePath: string,
  contents: string,
  identifierHashes: ReadonlySet<string>,
): PersonalDataFinding[] {
  const findings: PersonalDataFinding[] = [];

  for (const [rule, pattern] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of contents.matchAll(pattern)) {
      findings.push(
        finding(relativePath, rule, lineNumber(contents, match.index)),
      );
    }
  }

  const homePatterns = [
    /\b[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+[\\/]/g,
    /\/Users\/[^/\s"']+\//g,
    /\/home\/[^/\s"']+\//g,
  ];
  for (const pattern of homePatterns) {
    for (const match of contents.matchAll(pattern)) {
      findings.push(
        finding(
          relativePath,
          "absolute-developer-home",
          lineNumber(contents, match.index),
        ),
      );
    }
  }

  const isFixture = relativePath
    .toLowerCase()
    .split(/[\\/]/)
    .some((segment) => segment === "fixture" || segment === "fixtures");
  const emailPattern =
    /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,}|localhost)\b/gi;
  for (const match of contents.matchAll(emailPattern)) {
    const domain = match[1].toLowerCase();
    if (
      CONSUMER_EMAIL_DOMAINS.has(domain) ||
      (isFixture && !isReservedEmailDomain(domain))
    ) {
      findings.push(
        finding(
          relativePath,
          "personal-account-identifier",
          lineNumber(contents, match.index),
        ),
      );
    }
  }

  if (identifierHashes.size > 0) {
    const tokens = contents.match(/[A-Za-z0-9._:@/+-]{6,160}/g) ?? [];
    for (const token of tokens) {
      const digest = createHash("sha256").update(token).digest("hex");
      if (identifierHashes.has(digest)) {
        const index = contents.indexOf(token);
        findings.push(
          finding(
            relativePath,
            "known-production-identifier",
            lineNumber(contents, index),
          ),
        );
      }
    }
  }

  return findings;
}

async function loadIdentifierHashes(): Promise<Set<string>> {
  const hashes = new Set<string>();
  const contents = await readFile(IDENTIFIER_HASHES, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (!HASH.test(line)) {
      throw new Error("Malformed production identifier hash policy.");
    }
    hashes.add(line);
  }
  return hashes;
}

function normalizeRelative(root: string, absolute: string): string {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  if (!relative || relative === ".." || relative.startsWith("../")) {
    throw new Error("Personal-data guard received an unsafe path.");
  }
  return relative;
}

async function verifyLargeBinaryFixture(
  root: string,
  relativePath: string,
  size: number,
  candidateSet: ReadonlySet<string> | undefined,
): Promise<PersonalDataFinding[]> {
  const segments = relativePath.toLowerCase().split("/");
  if (
    !segments.some((segment) => segment === "fixture" || segment === "fixtures")
  ) {
    return [finding(relativePath, "large-binary-artifact")];
  }

  const sidecar = `${relativePath}.provenance.json`;
  if (candidateSet && !candidateSet.has(sidecar)) {
    return [finding(relativePath, "binary-fixture-missing-provenance")];
  }

  try {
    // SAFETY: every property of this untrusted JSON object is validated below
    // before it participates in a filesystem or checksum decision.
    const metadata = JSON.parse(
      await readFile(path.join(root, sidecar), "utf8"),
    ) as {
      license?: unknown;
      maxBytes?: unknown;
      sha256?: unknown;
      source?: unknown;
    };
    // oxlint-disable anti-slop/no-runtime-typeof -- provenance JSON is parsed at this I/O boundary
    if (
      typeof metadata.source !== "string" ||
      !metadata.source.trim() ||
      typeof metadata.license !== "string" ||
      !metadata.license.trim() ||
      typeof metadata.sha256 !== "string" ||
      !HASH.test(metadata.sha256) ||
      typeof metadata.maxBytes !== "number" ||
      !Number.isSafeInteger(metadata.maxBytes) ||
      size > metadata.maxBytes
    ) {
      return [finding(relativePath, "binary-fixture-invalid-provenance")];
    }
    // oxlint-enable anti-slop/no-runtime-typeof
    const bytes = await readFile(path.join(root, relativePath));
    const digest = createHash("sha256").update(bytes).digest("hex");
    return digest === metadata.sha256
      ? []
      : [finding(relativePath, "binary-fixture-checksum-mismatch")];
  } catch {
    return [finding(relativePath, "binary-fixture-invalid-provenance")];
  }
}

export async function inspectCandidate(
  rootInput: string,
  relativeInput: string,
  options: InspectOptions = {},
): Promise<PersonalDataFinding[]> {
  const root = path.resolve(rootInput);
  const absolute = path.resolve(root, relativeInput);
  const relativePath = normalizeRelative(root, absolute);
  const findings = pathFindings(relativePath);
  if (findings.length > 0) return findings;

  const fileStat = await lstat(absolute);
  if (fileStat.isSymbolicLink())
    return [finding(relativePath, "symbolic-link")];
  if (!fileStat.isFile()) return [];

  const extension = path.extname(relativePath).toLowerCase();
  const firstBytes = new Uint8Array(
    await Bun.file(absolute)
      .slice(0, Math.min(fileStat.size, 8192))
      .arrayBuffer(),
  );
  const looksBinary =
    BINARY_EXTENSIONS.has(extension) || firstBytes.some((byte) => byte === 0);

  if (looksBinary && fileStat.size > MAX_BINARY_FIXTURE_BYTES) {
    return verifyLargeBinaryFixture(
      root,
      relativePath,
      fileStat.size,
      options.candidateSet,
    );
  }
  if (looksBinary) return [];
  if (fileStat.size > MAX_TEXT_BYTES) {
    return [finding(relativePath, "oversized-text-file")];
  }

  const contents = await readFile(absolute, "utf8");
  const identifierHashes =
    options.identifierHashes ?? (await loadIdentifierHashes());
  return contentFindings(relativePath, contents, identifierHashes);
}

export async function runPersonalDataGuard(
  rootInput = process.cwd(),
): Promise<void> {
  const root = path.resolve(rootInput);
  const candidates = await collectWorkspaceCandidates({ root });
  const candidateSet = new Set(candidates);
  const identifierHashes = await loadIdentifierHashes();
  const findings: PersonalDataFinding[] = [];

  for (const candidate of candidates) {
    findings.push(
      ...(await inspectCandidate(root, candidate, {
        candidateSet,
        identifierHashes,
      })),
    );
  }

  if (findings.length > 0) {
    for (const item of findings) {
      const location = item.line ? `${item.file}:${item.line}` : item.file;
      console.error(`[personal-data] ${location} rule=${item.rule}`);
    }
    throw new Error(`${findings.length} personal-data release finding(s).`);
  }

  console.log(
    `Personal-data guard passed (${candidates.length} candidate files).`,
  );
}

if (import.meta.main) {
  try {
    await runPersonalDataGuard();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Personal-data guard failed.",
    );
    process.exit(1);
  }
}
