import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeSecretEqual } from "./identity";

const SESSION_COOKIE = "avermate_node_setup";
const SESSION_TTL_MS = 15 * 60_000;
const MAX_BOOTSTRAP_FAILURES = 5;

type SetupSession = {
  id: string;
  csrf: string;
  host: string;
  expiresAt: number;
};

function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const item of cookies.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export const CONFIGURATOR_SECURITY_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

export class ConfiguratorSecurity {
  readonly #bootstrapPath: string;
  readonly #allowedHosts: Set<string>;
  readonly #sessions = new Map<string, SetupSession>();
  #bootstrapSecret: string | null = null;
  #bootstrapConsumed = false;
  #bootstrapFailures = 0;
  #blockedUntil = 0;
  #closed = false;

  constructor(input: { bootstrapPath: string; hosts: string[] }) {
    this.#bootstrapPath = input.bootstrapPath;
    this.#allowedHosts = new Set(input.hosts.map((host) => host.toLowerCase()));
  }

  async initialize() {
    if (this.#bootstrapSecret || this.#bootstrapConsumed) return;
    try {
      this.#bootstrapSecret = (
        await readFile(this.#bootstrapPath, "utf8")
      ).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#bootstrapSecret = randomSecret(36);
      await mkdir(dirname(this.#bootstrapPath), {
        recursive: true,
        mode: 0o700,
      });
      await writeFile(this.#bootstrapPath, `${this.#bootstrapSecret}\n`, {
        mode: 0o600,
        flag: "wx",
      });
    }
  }

  get setupOpen() {
    return !this.#closed;
  }

  #host(request: Request) {
    if (
      request.headers.has("forwarded") ||
      request.headers.has("x-forwarded-host") ||
      request.headers.has("x-original-host")
    ) {
      throw new Error("FORWARDED_HOST_NOT_TRUSTED");
    }
    const host = request.headers.get("host")?.trim().toLowerCase();
    if (!host || !this.#allowedHosts.has(host))
      throw new Error("CONFIGURATOR_HOST_REJECTED");
    return host;
  }

  assertBaseRequest(request: Request) {
    if (this.#closed) throw new Error("CONFIGURATOR_CLOSED");
    const host = this.#host(request);
    if (request.headers.get("upgrade")) {
      const origin = request.headers.get("origin");
      if (!origin || origin !== `http://${host}`)
        throw new Error("WEBSOCKET_ORIGIN_REJECTED");
      throw new Error("WEBSOCKET_UNSUPPORTED");
    }
    return host;
  }

  #assertOrigin(request: Request, host: string) {
    const origin = request.headers.get("origin");
    if (origin !== `http://${host}`)
      throw new Error("CONFIGURATOR_ORIGIN_REJECTED");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite !== "same-origin" && fetchSite !== "none") {
      throw new Error("CONFIGURATOR_FETCH_SITE_REJECTED");
    }
  }

  async exchangeBootstrap(request: Request, secret: string, now = Date.now()) {
    const host = this.assertBaseRequest(request);
    this.#assertOrigin(request, host);
    if (now < this.#blockedUntil) throw new Error("BOOTSTRAP_RATE_LIMITED");
    if (this.#bootstrapConsumed || !this.#bootstrapSecret)
      throw new Error("BOOTSTRAP_CONSUMED");
    if (!safeSecretEqual(secret, this.#bootstrapSecret)) {
      this.#bootstrapFailures += 1;
      if (this.#bootstrapFailures >= MAX_BOOTSTRAP_FAILURES) {
        const exponent = Math.min(
          6,
          this.#bootstrapFailures - MAX_BOOTSTRAP_FAILURES,
        );
        this.#blockedUntil = now + 1_000 * 2 ** exponent;
      }
      throw new Error("BOOTSTRAP_INVALID");
    }
    this.#bootstrapConsumed = true;
    this.#bootstrapSecret = null;
    await rm(this.#bootstrapPath, { force: true });
    this.#sessions.clear();
    return this.#newSession(host, now);
  }

  #newSession(host: string, now = Date.now()) {
    const session: SetupSession = {
      id: randomSecret(32),
      csrf: randomSecret(24),
      host,
      expiresAt: now + SESSION_TTL_MS,
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  requireSession(request: Request, input: { mutating: boolean; now?: number }) {
    const host = this.assertBaseRequest(request);
    const now = input.now ?? Date.now();
    const id = cookieValue(request, SESSION_COOKIE);
    const session = id ? this.#sessions.get(id) : undefined;
    if (!session || session.expiresAt <= now || session.host !== host) {
      if (id) this.#sessions.delete(id);
      throw new Error("SETUP_SESSION_INVALID");
    }
    if (input.mutating) {
      this.#assertOrigin(request, host);
      const csrf = request.headers.get("x-csrf-token") ?? "";
      if (!safeSecretEqual(csrf, session.csrf)) throw new Error("CSRF_INVALID");
    }
    session.expiresAt = now + SESSION_TTL_MS;
    return session;
  }

  rotate(session: SetupSession, now = Date.now()) {
    this.#sessions.delete(session.id);
    return this.#newSession(session.host, now);
  }

  close() {
    this.#closed = true;
    this.#sessions.clear();
    this.#bootstrapSecret = null;
  }

  sessionHeaders(session: SetupSession, secure = false) {
    const attributes = [
      `${SESSION_COOKIE}=${session.id}`,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/api/setup",
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}`,
    ];
    if (secure) attributes.push("Secure");
    return {
      "set-cookie": attributes.join("; "),
      "x-csrf-token": session.csrf,
    };
  }
}

export function secureResponse(
  body: BodyInit | null,
  input: { status?: number; headers?: HeadersInit } = {},
) {
  return new Response(body, {
    status: input.status,
    headers: { ...CONFIGURATOR_SECURITY_HEADERS, ...input.headers },
  });
}
