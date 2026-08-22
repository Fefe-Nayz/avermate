import {
  ConnectionConfig,
  Sandbox,
  SandboxManager,
  type ConnectionConfigOptions,
} from "@alibaba-group/opensandbox";
import {
  sandboxBaselineEvidenceSchema,
  type SandboxBaselineEvidence,
  type SandboxCreateInput,
  type SandboxExecutionEvent,
  type SandboxExecutionProfile,
  type SandboxFileManifestEntry,
  type SandboxHandle,
  type SandboxInputFile,
  type SandboxIsolationClass,
  type SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { SandboxPolicyError, SandboxUnavailableError } from "./errors";
import type { RemoteSandboxTransport } from "./remote-provider";

const WORKSPACE = "/workspace";
const SNAPSHOT_FORMAT_PREFIX = "opensandbox-native-v1:";

export interface OpenSandboxSdkTransportConfig {
  connection: ConnectionConfigOptions;
  evidenceUrl: string;
  evidenceToken?: string;
  imageUris: Readonly<Record<string, string>>;
  profiles: readonly SandboxExecutionProfile[];
  requestTimeoutMs?: number;
  fetch?: typeof fetch;
}

export function createOpenSandboxSdkTransportFromEnvironment(input: {
  environment: Readonly<Record<string, string | undefined>>;
  profiles: readonly SandboxExecutionProfile[];
}): OpenSandboxSdkTransport {
  const environment = input.environment;
  const domain =
    environment.SANDBOX_OPENSANDBOX_DOMAIN?.trim() ||
    environment.OPEN_SANDBOX_DOMAIN?.trim();
  const evidenceUrl = environment.SANDBOX_OPENSANDBOX_EVIDENCE_URL?.trim();
  if (!domain || !evidenceUrl) {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "OpenSandbox requires SANDBOX_OPENSANDBOX_DOMAIN and SANDBOX_OPENSANDBOX_EVIDENCE_URL.",
    );
  }
  if (
    domain.includes("://") ||
    domain.includes("/") ||
    domain.includes("@")
  ) {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "SANDBOX_OPENSANDBOX_DOMAIN must contain only host[:port].",
    );
  }
  const protocol =
    environment.SANDBOX_OPENSANDBOX_PROTOCOL?.trim().toLowerCase() || "http";
  if (protocol !== "http" && protocol !== "https") {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "SANDBOX_OPENSANDBOX_PROTOCOL must be http or https.",
    );
  }
  const imageUris: Record<string, string> = {};
  for (const profile of input.profiles.filter((value) => value.enabled)) {
    const stem = profile.id.replaceAll("-", "_").toUpperCase();
    const uri = environment[`SANDBOX_PROFILE_${stem}_IMAGE_URI`]?.trim();
    if (!uri) {
      throw new SandboxUnavailableError(
        "CONFIGURATION_INVALID",
        `SANDBOX_PROFILE_${stem}_IMAGE_URI is required for an enabled OpenSandbox profile.`,
      );
    }
    imageUris[profile.id] = uri;
  }
  return new OpenSandboxSdkTransport({
    connection: {
      domain,
      protocol,
      apiKey: environment.OPEN_SANDBOX_API_KEY?.trim() || undefined,
      requestTimeoutSeconds: 30,
      useServerProxy:
        environment.SANDBOX_OPENSANDBOX_USE_SERVER_PROXY !== "false",
    },
    evidenceUrl,
    evidenceToken:
      environment.SANDBOX_OPENSANDBOX_EVIDENCE_TOKEN?.trim() || undefined,
    imageUris,
    profiles: input.profiles,
  });
}

/**
 * Production OpenSandbox transport. Lifecycle, command streaming, files and
 * native snapshots use the official SDK. Isolation evidence is deliberately
 * fetched from a separately deployed host probe; the workload container is
 * never trusted to attest its own runtime.
 */
export class OpenSandboxSdkTransport implements RemoteSandboxTransport {
  readonly #connection: ConnectionConfig;
  readonly #evidenceUrl: URL;
  readonly #profiles: Map<string, SandboxExecutionProfile>;
  readonly #imageUris: Readonly<Record<string, string>>;
  readonly #sandboxes = new Map<string, Sandbox>();
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(private readonly config: OpenSandboxSdkTransportConfig) {
    this.#connection = new ConnectionConfig(config.connection);
    this.#evidenceUrl = validatedEvidenceUrl(config.evidenceUrl);
    this.#profiles = new Map(
      config.profiles.map((profile) => [profile.id, profile]),
    );
    this.#imageUris = Object.freeze({ ...config.imageUris });
    this.#requestTimeoutMs = Math.min(
      60_000,
      Math.max(1_000, config.requestTimeoutMs ?? 15_000),
    );
    this.#fetch = config.fetch ?? fetch;
    for (const profile of config.profiles.filter((value) => value.enabled)) {
      const uri = this.#imageUris[profile.id];
      if (!uri || !uri.endsWith(`@${profile.image.imageDigest}`)) {
        throw new SandboxUnavailableError(
          "CONFIGURATION_INVALID",
          `OpenSandbox image URI for ${profile.id} must end with its reviewed digest.`,
        );
      }
    }
  }

  async probe(input: {
    providerId: "opensandbox" | "e2b" | "microsandbox";
    profile: SandboxExecutionProfile;
    isolationClass: SandboxIsolationClass;
    expectedHostPolicyDigest: string;
  }): Promise<SandboxBaselineEvidence> {
    if (input.providerId !== "opensandbox") {
      throw new SandboxUnavailableError(
        "CONFIGURATION_INVALID",
        "The OpenSandbox transport cannot attest another provider.",
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#requestTimeoutMs);
    try {
      const response = await this.#fetch(this.#evidenceUrl, {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(this.config.evidenceToken
            ? { authorization: `Bearer ${this.config.evidenceToken}` }
            : {}),
        },
        body: JSON.stringify({
          baselineVersion: 1,
          providerId: input.providerId,
          profileId: input.profile.id,
          profileVersion: input.profile.version,
          imageDigest: input.profile.image.imageDigest,
          isolationClass: input.isolationClass,
          hostPolicyDigest: input.expectedHostPolicyDigest,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Host evidence probe returned HTTP ${response.status}`);
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > 256 * 1024) {
        throw new Error("Host evidence response exceeds 256 KiB");
      }
      return sandboxBaselineEvidenceSchema.parse(JSON.parse(text));
    } finally {
      clearTimeout(timeout);
    }
  }

  async create(
    input: SandboxCreateInput & {
      evidence: SandboxBaselineEvidence;
      isolationClass: SandboxIsolationClass;
    },
  ): Promise<{ sandboxId: string }> {
    const source = input.workspaceSnapshotRef
      ? await this.#verifiedSnapshot(input.workspaceSnapshotRef, input.ownerId)
      : null;
    const sandbox = await Sandbox.create({
      connectionConfig: this.#connection,
      ...(source
        ? { snapshotId: source }
        : { image: this.#requiredImage(input.profile) }),
      timeoutSeconds: Math.max(
        1,
        Math.ceil((input.expiresAt.getTime() - Date.now()) / 1_000),
      ),
      secureAccess: true,
      env: {},
      metadata: this.#metadata(input),
      networkPolicy: networkPolicy(input.profile),
      resource: {
        cpu: String(input.profile.resources.cpuMillis / 1_000),
        memory: `${Math.ceil(input.profile.resources.memoryBytes / 1024 ** 2)}Mi`,
      },
      extensions: {
        "avermate.profile": `${input.profile.id}@${input.profile.version}`,
        "avermate.image-digest": input.profile.image.imageDigest,
        "avermate.host-policy-digest": input.expectedHostPolicyDigest,
        "avermate.isolation-class": input.isolationClass,
        "avermate.readonly-rootfs": "true",
        "avermate.drop-capabilities": "all",
        "avermate.no-new-privileges": "true",
        "avermate.pids-limit": String(input.profile.resources.pids),
        "avermate.tmpfs-bytes": String(input.profile.resources.tmpfsBytes),
        "avermate.tmpfs-inodes": String(input.profile.resources.tmpfsInodes),
      },
    });
    this.#sandboxes.set(sandbox.id, sandbox);
    return { sandboxId: sandbox.id };
  }

  async *execute(input: Parameters<RemoteSandboxTransport["execute"]>[0]): AsyncIterable<SandboxExecutionEvent> {
    const sandbox = await this.#sandbox(input.handle);
    const profile = this.#profile(input.handle.profileId);
    const limits = { ...profile.resources, ...(input.resources ?? {}) };
    const command = [input.executable, ...input.argv]
      .map(posixQuote)
      .join(" ");
    let started = false;
    let exited = false;
    let outputBytes = 0;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let exitCode = 0;
    for await (const event of sandbox.commands.runStream(
      command,
      {
        workingDirectory: input.cwd ?? WORKSPACE,
        timeoutSeconds: Math.max(1, Math.ceil(limits.wallTimeMs / 1_000)),
        uid: 1000,
        gid: 1000,
        envs: { ...(input.environment ?? {}) },
      },
      input.signal,
    )) {
      if (!started) {
        started = true;
        yield { type: "started", at: new Date().toISOString() };
      }
      if (event.type === "stdout" || event.type === "stderr") {
        const raw = typeof event.text === "string" ? event.text : "";
        const current = event.type === "stdout" ? stdoutBytes : stderrBytes;
        const ceiling =
          event.type === "stdout" ? limits.stdoutBytes : limits.stderrBytes;
        const remaining = Math.max(0, ceiling - current);
        const bounded = boundedUtf8(raw, remaining);
        const byteLength = new TextEncoder().encode(bounded).byteLength;
        outputBytes += byteLength;
        if (event.type === "stdout") stdoutBytes += byteLength;
        else stderrBytes += byteLength;
        yield {
          type: event.type,
          chunk: bounded,
          truncated: bounded !== raw,
        };
        continue;
      }
      if (event.type === "error") {
        exitCode = numericExitCode(event.error) ?? 1;
        continue;
      }
      if (event.type === "execution_complete") {
        exited = true;
        yield {
          type: "exited",
          at: new Date().toISOString(),
          exitCode,
          signal: null,
          outputBytes,
        };
      }
    }
    if (!started) yield { type: "started", at: new Date().toISOString() };
    if (!exited) {
      yield {
        type: "exited",
        at: new Date().toISOString(),
        exitCode,
        signal: input.signal?.aborted ? "ABORT" : null,
        outputBytes,
      };
    }
  }

  async putFiles(
    handle: SandboxHandle,
    files: readonly SandboxInputFile[],
  ): Promise<void> {
    const sandbox = await this.#sandbox(handle);
    if (files.length === 0) return;
    const directories = new Set<string>([`${WORKSPACE}/input`]);
    for (const file of files) {
      const absolute = absoluteWorkspacePath(file.relativePath);
      const parent = absolute.slice(0, absolute.lastIndexOf("/"));
      directories.add(parent);
    }
    await sandbox.files.createDirectories(
      [...directories]
        .sort((a, b) => a.length - b.length)
        .map((path) => ({ path, mode: 0o700 })),
    );
    await sandbox.files.writeFiles(
      files.map((file) => ({
        path: absoluteWorkspacePath(file.relativePath),
        data: file.bytes,
        mode: 0o400,
      })),
    );
  }

  async getFiles(
    handle: SandboxHandle,
    paths: readonly string[],
  ): Promise<readonly SandboxFileManifestEntry[]> {
    const sandbox = await this.#sandbox(handle);
    const absolute = paths.map(absoluteWorkspacePath);
    const info = await sandbox.files.getFileInfo(absolute);
    const manifest: SandboxFileManifestEntry[] = [];
    for (let index = 0; index < paths.length; index += 1) {
      const relativePath = paths[index]!;
      const absolutePath = absolute[index]!;
      const entry = info[absolutePath];
      if (!entry || entry.type !== "file") {
        throw new SandboxPolicyError(
          "filesystem",
          `OpenSandbox output is missing or not a regular file: ${relativePath}`,
        );
      }
      const bytes = await sandbox.files.readBytes(absolutePath);
      const classified = classifyPath(relativePath);
      manifest.push({
        relativePath,
        digest: digest(bytes),
        byteSize: bytes.byteLength,
        mimeType: classified.mimeType,
        kind: classified.kind,
        nodeType: "file",
      });
    }
    return manifest;
  }

  async *readFile(
    handle: SandboxHandle,
    relativePath: string,
  ): AsyncIterable<Uint8Array> {
    const sandbox = await this.#sandbox(handle);
    yield* sandbox.files.readBytesStream(absoluteWorkspacePath(relativePath));
  }

  async snapshotWorkspace(
    handle: SandboxHandle,
  ): Promise<SandboxWorkspaceSnapshotRef> {
    const sandbox = await this.#sandbox(handle);
    const manager = SandboxManager.create({ connectionConfig: this.#connection });
    try {
      const ownerHash = ownerDigest(handle.ownerId);
      const created = await manager.createSnapshot(handle.sandboxId, {
        name: `avermate-${ownerHash}`,
      });
      const ready = await waitForSnapshot(manager, created.id);
      if (ready.name !== `avermate-${ownerHash}`) {
        throw new Error("OpenSandbox snapshot ownership marker diverged");
      }
      return snapshotRef(ready.id, ownerHash);
    } finally {
      await manager.close();
      await sandbox.close().catch(() => undefined);
      this.#sandboxes.delete(handle.sandboxId);
    }
  }

  async forkWorkspace(
    input: SandboxCreateInput & {
      source: SandboxWorkspaceSnapshotRef;
      evidence: SandboxBaselineEvidence;
      isolationClass: SandboxIsolationClass;
    },
  ): Promise<{ sandboxId: string }> {
    const snapshotId = await this.#verifiedSnapshot(input.source, input.ownerId);
    const sandbox = await Sandbox.create({
      connectionConfig: this.#connection,
      snapshotId,
      timeoutSeconds: Math.max(
        1,
        Math.ceil((input.expiresAt.getTime() - Date.now()) / 1_000),
      ),
      secureAccess: true,
      metadata: this.#metadata(input),
      networkPolicy: networkPolicy(input.profile),
      resource: {
        cpu: String(input.profile.resources.cpuMillis / 1_000),
        memory: `${Math.ceil(input.profile.resources.memoryBytes / 1024 ** 2)}Mi`,
      },
    });
    this.#sandboxes.set(sandbox.id, sandbox);
    return { sandboxId: sandbox.id };
  }

  async stop(handle: SandboxHandle): Promise<void> {
    const sandbox = await this.#sandbox(handle);
    try {
      await sandbox.pause();
    } finally {
      await sandbox.close();
      this.#sandboxes.delete(handle.sandboxId);
    }
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    const existing = this.#sandboxes.get(handle.sandboxId);
    const manager = SandboxManager.create({ connectionConfig: this.#connection });
    try {
      await manager.killSandbox(handle.sandboxId);
    } finally {
      await existing?.close().catch(() => undefined);
      this.#sandboxes.delete(handle.sandboxId);
      await manager.close();
    }
  }

  async #sandbox(handle: SandboxHandle): Promise<Sandbox> {
    const existing = this.#sandboxes.get(handle.sandboxId);
    if (existing) return existing;
    const connected = await Sandbox.connect({
      sandboxId: handle.sandboxId,
      connectionConfig: this.#connection,
    });
    this.#sandboxes.set(handle.sandboxId, connected);
    return connected;
  }

  #profile(id: string): SandboxExecutionProfile {
    const profile = this.#profiles.get(id);
    if (!profile?.enabled) {
      throw new SandboxUnavailableError(
        "PROFILE_DISABLED",
        `OpenSandbox profile ${id} is disabled.`,
      );
    }
    return profile;
  }

  #requiredImage(profile: SandboxExecutionProfile): string {
    this.#profile(profile.id);
    const uri = this.#imageUris[profile.id];
    if (!uri) {
      throw new SandboxUnavailableError(
        "CONFIGURATION_INVALID",
        `OpenSandbox image URI for ${profile.id} is unavailable.`,
      );
    }
    return uri;
  }

  #metadata(input: SandboxCreateInput): Record<string, string> {
    return {
      "avermate-owner": ownerDigest(input.ownerId),
      "avermate-thread": ownerDigest(input.threadId),
      "avermate-branch": ownerDigest(input.branchId),
      "avermate-profile": `${input.profile.id}@${input.profile.version}`,
    };
  }

  async #verifiedSnapshot(
    ref: SandboxWorkspaceSnapshotRef,
    ownerId: string,
  ): Promise<string> {
    if (ref.provider !== "opensandbox") {
      throw new SandboxUnavailableError(
        "SNAPSHOT_INCOMPATIBLE",
        "Workspace snapshot belongs to another provider.",
      );
    }
    const snapshotId = decodeSnapshotId(ref.format);
    const ownerHash = ownerDigest(ownerId);
    if (snapshotRef(snapshotId, ownerHash).digest !== ref.digest) {
      throw new SandboxUnavailableError(
        "SNAPSHOT_INCOMPATIBLE",
        "Workspace snapshot digest is invalid.",
      );
    }
    const manager = SandboxManager.create({ connectionConfig: this.#connection });
    try {
      const snapshot = await manager.getSnapshot(snapshotId);
      if (
        snapshot.status.state !== "Ready" ||
        snapshot.name !== `avermate-${ownerHash}`
      ) {
        throw new SandboxUnavailableError(
          "SNAPSHOT_INCOMPATIBLE",
          "Workspace snapshot is not ready or not owned by this account.",
        );
      }
      return snapshot.id;
    } finally {
      await manager.close();
    }
  }
}

function validatedEvidenceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "SANDBOX_OPENSANDBOX_EVIDENCE_URL must be an absolute URL.",
    );
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "OpenSandbox host evidence requires HTTPS, except on loopback.",
    );
  }
  if (url.username || url.password || url.hash) {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "OpenSandbox host evidence URL cannot contain credentials or a fragment.",
    );
  }
  return url;
}

function networkPolicy(profile: SandboxExecutionProfile) {
  if (profile.egress.mode === "none") {
    return { defaultAction: "deny" as const, egress: [] };
  }
  for (const destination of profile.egress.destinations) {
    if (
      destination.protocol !== "https" ||
      destination.port !== 443 ||
      destination.pathPrefix !== "/"
    ) {
      throw new SandboxPolicyError(
        "egress",
        "OpenSandbox network rules cannot prove path or non-standard-port restrictions.",
      );
    }
  }
  return {
    defaultAction: "deny" as const,
    egress: profile.egress.destinations.map((destination) => ({
      action: "allow" as const,
      target: destination.hostname,
    })),
  };
}

function posixQuote(value: string): string {
  if (value.includes("\0")) {
    throw new SandboxPolicyError("process", "Command arguments cannot contain NUL.");
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function boundedUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return value;
  return new TextDecoder().decode(bytes.slice(0, maxBytes));
}

function numericExitCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { value?: unknown }).value;
  if (typeof value !== "string" || !/^-?\d+$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function absoluteWorkspacePath(relativePath: string): string {
  return `${WORKSPACE}/${relativePath}`;
}

function ownerDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function snapshotRef(
  snapshotId: string,
  ownerHash: string,
): SandboxWorkspaceSnapshotRef {
  const format = `${SNAPSHOT_FORMAT_PREFIX}${snapshotId}`;
  if (format.length > 128 || !snapshotId || /[\u0000-\u001f]/u.test(snapshotId)) {
    throw new SandboxUnavailableError(
      "SNAPSHOT_INCOMPATIBLE",
      "OpenSandbox snapshot identifier cannot be represented safely.",
    );
  }
  return {
    provider: "opensandbox",
    digest: digest(
      new TextEncoder().encode(`${SNAPSHOT_FORMAT_PREFIX}\0${snapshotId}\0${ownerHash}`),
    ),
    format,
  };
}

function decodeSnapshotId(format: string): string {
  if (!format.startsWith(SNAPSHOT_FORMAT_PREFIX)) {
    throw new SandboxUnavailableError(
      "SNAPSHOT_INCOMPATIBLE",
      "Unsupported OpenSandbox workspace snapshot format.",
    );
  }
  const id = format.slice(SNAPSHOT_FORMAT_PREFIX.length);
  if (!id) {
    throw new SandboxUnavailableError(
      "SNAPSHOT_INCOMPATIBLE",
      "OpenSandbox workspace snapshot identifier is missing.",
    );
  }
  return id;
}

async function waitForSnapshot(
  manager: SandboxManager,
  snapshotId: string,
): Promise<Awaited<ReturnType<SandboxManager["getSnapshot"]>>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const snapshot = await manager.getSnapshot(snapshotId);
    if (snapshot.status.state === "Ready") return snapshot;
    if (snapshot.status.state === "Failed") {
      throw new Error(
        `OpenSandbox snapshot failed: ${snapshot.status.reason ?? "unknown"}`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("OpenSandbox snapshot did not become ready within 30 seconds");
}

function classifyPath(
  path: string,
): Pick<SandboxFileManifestEntry, "kind" | "mimeType"> {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return { kind: "pdf", mimeType: "application/pdf" };
  if (lower.endsWith(".png")) return { kind: "png", mimeType: "image/png" };
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
    return { kind: "jpeg", mimeType: "image/jpeg" };
  if (lower.endsWith(".json"))
    return { kind: "json", mimeType: "application/json" };
  if (lower.endsWith(".csv")) return { kind: "csv", mimeType: "text/csv" };
  if (lower.endsWith(".txt") || lower.endsWith(".md"))
    return { kind: "text", mimeType: "text/plain" };
  if (lower.endsWith(".pptx"))
    return {
      kind: "pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
  if (lower.endsWith(".mp3")) return { kind: "mp3", mimeType: "audio/mpeg" };
  if (lower.endsWith(".wav")) return { kind: "wav", mimeType: "audio/wav" };
  if (lower.endsWith(".mp4")) return { kind: "mp4", mimeType: "video/mp4" };
  if (lower.endsWith(".webp")) return { kind: "webp", mimeType: "image/webp" };
  if (lower.endsWith(".vtt")) return { kind: "vtt", mimeType: "text/vtt" };
  return { kind: "binary", mimeType: "application/octet-stream" };
}
