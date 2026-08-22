import { isIP } from "node:net";
import type {
  SandboxEgressPolicy,
  SandboxExecutionProfile,
  SandboxResourceLimits,
  SandboxSecretGrant,
} from "@avermate/agent-contracts";
import { SandboxPolicyError } from "./errors";

const SAFE_ENV_NAMES = new Set(["HOME", "LANG", "LC_ALL", "TZ", "SOURCE_DATE_EPOCH"]);
const SECRET_ENV_PATTERN = /(AUTH|COOKIE|CREDENTIAL|DATABASE|KEY|PASSWORD|SECRET|TOKEN)/iu;
const RESOURCE_LIMIT_KEYS = [
  "cpuMillis",
  "memoryBytes",
  "swapBytes",
  "pids",
  "wallTimeMs",
  "cancellationGraceMs",
  "outputBytes",
  "stdoutBytes",
  "stderrBytes",
  "eventBytes",
  "workspaceBytes",
  "fileCount",
  "tmpfsBytes",
  "tmpfsInodes",
  "openFiles",
  "networkBytes",
  "networkRequests",
  "gpuCount",
] as const satisfies readonly (keyof SandboxResourceLimits)[];

export function assertSafeRelativePath(value: string): string {
  if (
    value.length === 0 ||
    value.length > 1_024 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..") ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new SandboxPolicyError("filesystem", `Unsafe workspace-relative path: ${value}`);
  }
  return value;
}

export function assertExecutionPolicy(input: {
  profile: SandboxExecutionProfile;
  executable: string;
  argv: readonly string[];
  cwd?: string;
  environment?: Readonly<Record<string, string>>;
  resources?: Partial<SandboxResourceLimits>;
  secretGrants?: readonly SandboxSecretGrant[];
  now?: Date;
}): void {
  if (!input.profile.entrypoints.includes(input.executable)) {
    throw new SandboxPolicyError("process", "Executable is not an exact profile entrypoint.");
  }
  if (input.argv.length > 256 || input.argv.some((arg) => arg.length > 16_384 || arg.includes("\0"))) {
    throw new SandboxPolicyError("process", "Argument vector exceeds the profile boundary.");
  }
  if (input.cwd && !input.cwd.startsWith("/workspace/")) {
    throw new SandboxPolicyError("filesystem", "Working directory must remain under /workspace/.");
  }
  assertResourceCeilings(input.profile.resources, input.resources ?? {});
  sanitizeSandboxEnvironment(input.environment ?? {});
  assertSecretGrants(input.profile, input.secretGrants ?? [], input.now ?? new Date());
}

export function assertResourceCeilings(
  ceiling: SandboxResourceLimits,
  requested: Partial<SandboxResourceLimits>,
): void {
  for (const key of RESOURCE_LIMIT_KEYS) {
    const value = requested[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0 || value > ceiling[key]) {
      throw new SandboxPolicyError("resource", `${key} exceeds the immutable profile ceiling.`);
    }
  }
}

export function sanitizeSandboxEnvironment(
  environment: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (
      !SAFE_ENV_NAMES.has(name) ||
      SECRET_ENV_PATTERN.test(name) ||
      value.length > 4_096 ||
      value.includes("\0")
    ) {
      throw new SandboxPolicyError("secret", `Environment variable ${name} is not allowed.`);
    }
    sanitized[name] = value;
  }
  if (sanitized.HOME && sanitized.HOME !== "/workspace") {
    throw new SandboxPolicyError("filesystem", "HOME is fixed to /workspace when provided.");
  }
  return Object.freeze(sanitized);
}

function assertSecretGrants(
  profile: SandboxExecutionProfile,
  grants: readonly SandboxSecretGrant[],
  now: Date,
): void {
  if (grants.length > 0 && !profile.allowSecrets) {
    throw new SandboxPolicyError("secret", "This profile does not accept brokered secret grants.");
  }
  for (const grant of grants) {
    if (new Date(grant.expiresAt).getTime() <= now.getTime()) {
      throw new SandboxPolicyError("secret", `Secret grant ${grant.grantId} is expired.`);
    }
  }
}

export function authorizeSandboxEgress(input: {
  policy: SandboxEgressPolicy;
  url: string;
  resolvedAddresses: readonly string[];
  redirectFrom?: string;
}): URL {
  if (input.policy.mode === "none") {
    throw new SandboxPolicyError("egress", "Network access is disabled for this profile.");
  }

  let target: URL;
  try {
    target = new URL(input.url);
  } catch {
    throw new SandboxPolicyError("egress", "Malformed egress URL.");
  }
  if (target.username || target.password || target.hash) {
    throw new SandboxPolicyError("egress", "Credentials and fragments are forbidden in egress URLs.");
  }
  if (!input.resolvedAddresses.length || input.resolvedAddresses.some(isForbiddenAddress)) {
    throw new SandboxPolicyError("egress", "Destination resolves to an unverified or non-public address.");
  }

  const protocol = target.protocol.slice(0, -1);
  const port = Number(target.port || (protocol === "https" || protocol === "wss" ? 443 : 0));
  const allowed = input.policy.destinations.some(
    (entry) =>
      entry.protocol === protocol &&
      entry.hostname === target.hostname.toLowerCase() &&
      entry.port === port &&
      target.pathname.startsWith(entry.pathPrefix),
  );
  if (!allowed) {
    throw new SandboxPolicyError("egress", "Destination is outside the explicit allowlist.");
  }
  if (input.redirectFrom) {
    const source = new URL(input.redirectFrom);
    if (source.origin !== target.origin) {
      throw new SandboxPolicyError("egress", "Cross-origin redirects require a new policy authorization.");
    }
  }
  return target;
}

function isForbiddenAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/gu, "");
  if (isIP(normalized) === 4) {
    return isForbiddenIpv4(normalized);
  }
  if (isIP(normalized) === 6) {
    const value = parseIpv6(normalized);
    if (value === null) return true;
    if (
      value === 0n ||
      value === 1n ||
      matchesIpv6Prefix(value, "fc00::", 7) ||
      matchesIpv6Prefix(value, "fe80::", 10) ||
      matchesIpv6Prefix(value, "fec0::", 10) ||
      matchesIpv6Prefix(value, "ff00::", 8) ||
      matchesIpv6Prefix(value, "100::", 64) ||
      matchesIpv6Prefix(value, "2001::", 23) ||
      matchesIpv6Prefix(value, "2001:db8::", 32) ||
      matchesIpv6Prefix(value, "2002::", 16) ||
      matchesIpv6Prefix(value, "3fff::", 20) ||
      matchesIpv6Prefix(value, "5f00::", 16)
    ) {
      return true;
    }
    const high96 = value >> 32n;
    if (high96 === 0n || high96 === 0xffffn) return true;
    if (matchesIpv6Prefix(value, "64:ff9b::", 96)) {
      return isForbiddenIpv4(ipv4FromInteger(Number(value & 0xffffffffn)));
    }
    if (matchesIpv6Prefix(value, "64:ff9b:1::", 48)) return true;
    return !matchesIpv6Prefix(value, "2000::", 3);
  }
  return true;
}

function isForbiddenIpv4(address: string): boolean {
  const [a, b, c] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIpv6(address: string): bigint | null {
  if (address.includes("%")) return null;
  let normalized = address;
  const ipv4 = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (ipv4) {
    const octets = ipv4.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) return null;
    normalized = normalized.slice(0, -ipv4.length) +
      `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) {
    return null;
  }
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function matchesIpv6Prefix(value: bigint, base: string, prefixBits: number): boolean {
  const parsedBase = parseIpv6(base);
  if (parsedBase === null) return false;
  const shift = BigInt(128 - prefixBits);
  return value >> shift === parsedBase >> shift;
}

function ipv4FromInteger(value: number): string {
  return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}
