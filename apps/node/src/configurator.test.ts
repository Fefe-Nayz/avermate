import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseHTML } from "linkedom";
import { parse } from "yaml";
import { defaultDevZeroConfig, loadNodeConfig, publicConfig } from "./config";
import { ConfiguratorSecurity } from "./configurator-security";
import { pairingCoreUrl } from "./configurator";
import { createNodeDaemon } from "./daemon";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "avermate-node-configurator-"));
  roots.push(root);
  const config = defaultDevZeroConfig(root);
  config.bind.port = 51_881;
  config.storage.filesystemRoot = join(root, "objects");
  const bootstrapPath = join(root, "bootstrap.secret");
  const daemon = await createNodeDaemon({
    config,
    configPath: join(root, "avermate-node.yaml"),
    bootstrapPath,
    configuratorFetch: (async (input: Parameters<typeof fetch>[0]) => {
      expect(String(input)).toBe(
        "https://core.example/api/node/pairing/register",
      );
      return Response.json({
        pairingAttemptId: "registered",
        replayed: false,
      });
    }) as unknown as typeof fetch,
  });
  const secret = (await readFile(bootstrapPath, "utf8")).trim();
  return { root, config, daemon, bootstrapPath, secret };
}

function request(
  path: string,
  input: {
    method?: string;
    host?: string;
    origin?: string;
    cookie?: string;
    csrf?: string;
    body?: unknown;
  } = {},
) {
  const host = input.host ?? "127.0.0.1:51881";
  const headers = new Headers({ host });
  if (input.origin !== undefined) headers.set("origin", input.origin);
  if (input.origin !== undefined) headers.set("sec-fetch-site", "same-origin");
  if (input.cookie) headers.set("cookie", input.cookie);
  if (input.csrf) headers.set("x-csrf-token", input.csrf);
  if (input.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://${host}${path}`, {
    method: input.method ?? "GET",
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
}

type PublicNodeConfig = ReturnType<typeof publicConfig>;

async function unlock(
  daemon: Awaited<ReturnType<typeof fixture>>["daemon"],
  secret: string,
) {
  const response = await daemon.fetch(
    request("/api/setup/session", {
      method: "POST",
      origin: "http://127.0.0.1:51881",
      body: { secret },
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    csrf: string;
    state: { config: PublicNodeConfig };
  };
  return {
    cookie: response.headers.get("set-cookie")!,
    csrf: response.headers.get("x-csrf-token")!,
    config: body.state.config,
  };
}

describe("local configurator security", () => {
  test("allows only the exact local Compose Core outside HTTPS", () => {
    expect(
      pairingCoreUrl("http://api:5000", "local-compose").toString(),
    ).toBe("http://api:5000/");
    expect(() =>
      pairingCoreUrl("http://localhost:5000", "local-compose"),
    ).toThrow("PAIRING_CORE_URL_INVALID");
    expect(() => pairingCoreUrl("http://api:5000", "tls")).toThrow(
      "PAIRING_CORE_URL_INVALID",
    );
  });

  test("rejects hostile host/origin and emits restrictive browser headers", async () => {
    const { daemon, secret } = await fixture();
    const hostileHost = await daemon.fetch(
      request("/setup", { host: "attacker.invalid" }),
    );
    expect(hostileHost.status).toBe(400);
    expect(hostileHost.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(hostileHost.headers.get("access-control-allow-origin")).toBeNull();

    const crossOrigin = await daemon.fetch(
      request("/api/setup/session", {
        method: "POST",
        origin: "http://attacker.invalid",
        body: { secret },
      }),
    );
    expect(crossOrigin.status).toBe(400);
    expect(await crossOrigin.text()).toContain("CONFIGURATOR_ORIGIN_REJECTED");
  });

  test("exchanges bootstrap once, binds csrf and rotates the session", async () => {
    const { daemon, secret } = await fixture();
    const login = await daemon.fetch(
      request("/api/setup/session", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        body: { secret },
      }),
    );
    expect(login.status).toBe(200);
    const loginText = await login.text();
    expect(loginText).not.toContain(secret);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const csrf = login.headers.get("x-csrf-token")!;

    const resumed = await daemon.fetch(request("/api/setup/state", { cookie }));
    expect(resumed.status).toBe(200);
    expect(resumed.headers.get("x-csrf-token")).toBe(csrf);

    const noCsrf = await daemon.fetch(
      request("/api/setup/pairing-code", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie,
        body: { coreUrl: "https://core.example" },
      }),
    );
    expect(noCsrf.status).toBe(400);
    expect(await noCsrf.text()).toContain("CSRF_INVALID");

    const paired = await daemon.fetch(
      request("/api/setup/pairing-code", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie,
        csrf,
        body: { coreUrl: "https://core.example" },
      }),
    );
    expect(paired.status).toBe(200);
    const body = (await paired.json()) as {
      code: string;
      offer: { fingerprint: string };
    };
    expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u);
    expect(body.offer.fingerprint).toHaveLength(32);
    expect(paired.headers.get("set-cookie")).not.toBe(cookie);

    const oldSession = await daemon.fetch(
      request("/api/setup/state", { cookie }),
    );
    expect(oldSession.status).toBe(400);

    const replay = await daemon.fetch(
      request("/api/setup/session", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        body: { secret },
      }),
    );
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("BOOTSTRAP_CONSUMED");
  });

  test("rate limits repeated bootstrap failures before accepting any secret", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-rate-"));
    roots.push(root);
    const bootstrapPath = join(root, "bootstrap.secret");
    const security = new ConfiguratorSecurity({
      bootstrapPath,
      hosts: ["127.0.0.1:5188"],
    });
    await security.initialize();
    const secret = (await readFile(bootstrapPath, "utf8")).trim();
    const make = () =>
      new Request("http://127.0.0.1:5188/api/setup/session", {
        method: "POST",
        headers: {
          host: "127.0.0.1:5188",
          origin: "http://127.0.0.1:5188",
          "sec-fetch-site": "same-origin",
        },
      });
    for (let index = 0; index < 5; index += 1) {
      await expect(
        security.exchangeBootstrap(make(), "wrong", 1_000),
      ).rejects.toThrow("BOOTSTRAP_INVALID");
    }
    await expect(
      security.exchangeBootstrap(make(), secret, 1_001),
    ).rejects.toThrow("BOOTSTRAP_RATE_LIMITED");
  });

  test("never embeds the bootstrap secret in setup assets", async () => {
    const { daemon, secret } = await fixture();
    for (const path of ["/setup", "/setup.js", "/setup.css", "/health"]) {
      const response = await daemon.fetch(request(path));
      expect(await response.text()).not.toContain(secret);
    }
  });

  test("serves a parseable, accessible setup UI covering every optional runtime", async () => {
    const { daemon } = await fixture();
    const html = await (await daemon.fetch(request("/setup"))).text();
    const script = await (await daemon.fetch(request("/setup.js"))).text();

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('for="secret"');
    expect(html).toContain('id="setup-language"');
    expect(html).toContain('data-i18n-aria-label="language"');
    expect(html).toContain('id="deployment"');
    expect(() => new Function(script)).not.toThrow();
    for (const marker of [
      "storage.driver",
      "retrieval.embeddingProvider",
      "retrieval.rerankProvider",
      "models.gateway",
      "sandbox.runtimeCheckpoints",
      "workers.opencode.commandCatalogue",
      "workers.openhands.commandCatalogue",
      "lifecycle.backupDir",
      "/api/setup/config/validate",
      "/api/setup/config/apply",
      "/api/setup/config/rollback",
      "/api/setup/deployment/preview",
    ]) {
      expect(script).toContain(marker);
    }
    for (const marker of [
      "englishGroups[group.id]",
      "englishLabels[field.path]",
      "tr('invalidNumber')",
      "action('valid'",
      "localStorage.setItem(localeKey,locale)",
    ]) {
      expect(script).toContain(marker);
    }
  });

  test("persists FR/EN and translates generated fields and runtime messages", async () => {
    const { daemon, config } = await fixture();
    const html = await (await daemon.fetch(request("/setup"))).text();
    const script = await (await daemon.fetch(request("/setup.js"))).text();
    const { document } = parseHTML(html);
    const stored = new Map<string, string>([
      ["avermate-node-setup-locale", "en"],
    ]);
    const localStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    };
    const browserFetch = async (path: string) => {
      if (path === "/api/setup/state") {
        return {
          ok: false,
          headers: new Headers(),
          json: async () => ({}),
        };
      }
      if (path === "/api/setup/session") {
        return {
          ok: true,
          headers: new Headers({ "x-csrf-token": "csrf-test" }),
          json: async () => ({
            csrf: "csrf-test",
            state: { config: publicConfig(config) },
          }),
        };
      }
      if (path === "/api/setup/config/rollback") {
        return {
          ok: true,
          headers: new Headers({ "x-csrf-token": "csrf-next" }),
          json: async () => ({ config: publicConfig(config), restored: true }),
        };
      }
      throw new Error(`UNEXPECTED_BROWSER_FETCH:${path}`);
    };
    new Function(
      "document",
      "localStorage",
      "navigator",
      "fetch",
      "URL",
      "Blob",
      "setTimeout",
      script,
    )(
      document,
      localStorage,
      { language: "fr-FR" },
      browserFetch,
      URL,
      Blob,
      setTimeout,
    );

    expect(document.documentElement.lang).toBe("en");
    expect(document.querySelector('[data-i18n="unlock"]')?.textContent).toBe(
      "Unlock",
    );
    await (
      document.querySelector<HTMLButtonElement>("#unlock")?.onclick as
        (() => Promise<unknown>) | undefined
    )?.();
    expect(
      document.querySelector('[data-field-path="storage.driver"]')?.textContent,
    ).toBe("Storage driver");
    expect(
      document.querySelector('[data-field-path="capabilities.sidecars"]')
        ?.textContent,
    ).toContain("Private sidecars");
    expect(document.querySelector("#status")?.textContent).toBe(
      "Configurator unlocked",
    );

    const selector =
      document.querySelector<HTMLSelectElement>("#setup-language")!;
    Object.defineProperty(selector, "value", {
      configurable: true,
      value: "fr",
    });
    (selector.onchange as unknown as (() => void) | null)?.();
    expect(stored.get("avermate-node-setup-locale")).toBe("fr");
    expect(
      document.querySelector('[data-field-path="storage.driver"]')?.textContent,
    ).toBe("Pilote de stockage");
    await (
      document.querySelector<HTMLButtonElement>("#rollback")
        ?.onclick as unknown as (() => Promise<unknown>) | null
    )?.();
    expect(document.querySelector("#error")?.textContent).toBe("");
    expect(document.querySelector("#status")?.textContent).toBe(
      "Dernière configuration restaurée",
    );
  });

  test("validates, applies and rolls back a browser-safe configuration", async () => {
    const { daemon, secret, config, root } = await fixture();
    const session = await unlock(daemon, secret);
    const next = structuredClone(session.config);
    next.storage.quotaBytes += 1_024;

    const validated = await daemon.fetch(
      request("/api/setup/config/validate", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie: session.cookie,
        csrf: session.csrf,
        body: next,
      }),
    );
    expect(validated.status).toBe(200);
    const validation = (await validated.json()) as {
      changes: { changedSections: string[] };
    };
    expect(validation.changes.changedSections).toContain("storage");

    const applied = await daemon.fetch(
      request("/api/setup/config/apply", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie: session.cookie,
        csrf: session.csrf,
        body: next,
      }),
    );
    expect(applied.status).toBe(200);
    const appliedBody = (await applied.json()) as {
      applied: boolean;
      restartRequired: boolean;
      config: PublicNodeConfig;
    };
    expect(appliedBody.applied).toBe(true);
    expect(appliedBody.restartRequired).toBe(true);
    expect(appliedBody.config.storage.quotaBytes).toBe(next.storage.quotaBytes);
    expect(
      (await loadNodeConfig(join(root, "avermate-node.yaml"))).storage
        .quotaBytes,
    ).toBe(next.storage.quotaBytes);

    const rolledBack = await daemon.fetch(
      request("/api/setup/config/rollback", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie: applied.headers.get("set-cookie")!,
        csrf: applied.headers.get("x-csrf-token")!,
        body: {},
      }),
    );
    expect(rolledBack.status).toBe(200);
    expect(
      (await loadNodeConfig(join(root, "avermate-node.yaml"))).storage
        .quotaBytes,
    ).toBe(config.storage.quotaBytes);
  });

  test("stores provider secrets without returning values or internal references", async () => {
    const { daemon, secret, root } = await fixture();
    const session = await unlock(daemon, secret);
    const rawSecret = "test-provider-secret-value";
    const stored = await daemon.fetch(
      request("/api/setup/secret", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie: session.cookie,
        csrf: session.csrf,
        body: { slot: "model-admin", value: rawSecret },
      }),
    );
    expect(stored.status).toBe(200);
    const storedText = await stored.text();
    expect(storedText).not.toContain(rawSecret);
    expect(storedText).not.toContain("secret:");
    expect(storedText).toContain('"configured":true');

    const next = structuredClone(session.config);
    next.models.adminSecretRef = "configured";
    const cookie = stored.headers.get("set-cookie")!;
    const csrf = stored.headers.get("x-csrf-token")!;
    const unsafe = structuredClone(session.config);
    unsafe.models.adminSecretRef = rawSecret;
    const rejected = await daemon.fetch(
      request("/api/setup/config/validate", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie,
        csrf,
        body: unsafe,
      }),
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).toContain(
      "CONFIGURATOR_SECRET_REFERENCE_INVALID",
    );

    const preview = await daemon.fetch(
      request("/api/setup/deployment/preview", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie,
        csrf,
        body: next,
      }),
    );
    expect(preview.status).toBe(200);
    const previewText = await preview.text();
    expect(previewText).not.toContain(rawSecret);
    expect(previewText).not.toContain("secret:");
    expect(previewText).toContain("avermate-node.override.yml");
    expect(previewText).toContain('"backupCreate"');

    const applied = await daemon.fetch(
      request("/api/setup/config/apply", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie,
        csrf,
        body: next,
      }),
    );
    expect(applied.status).toBe(200);
    const persisted = await readFile(join(root, "avermate-node.yaml"), "utf8");
    expect(persisted).not.toContain(rawSecret);
    expect(persisted).toContain("secret:setup-model-admin-");
    expect(await applied.text()).not.toContain("secret:");
  });

  test("edits private sidecars, seals their secret and generates internal-only Compose", async () => {
    const { daemon, secret, root } = await fixture();
    const session = await unlock(daemon, secret);
    const rawSecret = "private-sidecar-provider-secret";
    const stored = await daemon.fetch(
      request("/api/setup/secret", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie: session.cookie,
        csrf: session.csrf,
        body: {
          slot: "capability-sidecar:speech-sidecar",
          value: rawSecret,
        },
      }),
    );
    expect(stored.status).toBe(200);
    const imageDigest = `sha256:${"9".repeat(64)}`;
    const sidecar = {
      id: "speech-sidecar",
      enabled: true,
      descriptor: {
        schemaVersion: 1,
        connectionRevision: 1,
        pluginId: "avermate.node.sidecar",
        pluginVersion: "sidecar-plugin-r1",
        adapterRevision: "sidecar-adapter-r1",
        capability: "speech.transcribe",
        capabilityProtocolVersion: 1,
        provider: "local-speech",
        modelId: "local-speech-model",
        modelRevision: "local-speech-model-r1",
        dataHandling: {
          egress: "owner-node",
          providerName: null,
          region: null,
          disclosureRevision: "node-sidecar-v1",
          retentionDisclosureRevision: null,
          trainingDisclosureRevision: null,
          requiresExplicitConsent: false,
        },
        limits: {
          maxInputBytes: 32 * 1024 * 1024,
          maxOutputBytes: 8 * 1024 * 1024,
          maxBatchSize: 1,
          maxConcurrency: 1,
        },
        supportedLanguages: "unknown",
        healthCheckKind: "active-probe",
        specification: {
          modes: ["batch"],
          timestamps: ["none", "segment"],
          diarization: false,
          languageDetection: true,
          languageHint: true,
          vocabularyHints: false,
          inputMimeTypes: ["audio/mpeg"],
          maxBytes: 32 * 1024 * 1024,
          maxDurationSeconds: 7_200,
          maximumSpeakers: null,
        },
      },
      invocationModes: ["artifact-job"],
      baseUrl: "http://speech-sidecar:8080",
      secretRef: "configured",
      runtimeRevision: "speech-runtime-r1",
      imageDigest,
      egressPolicyDigest: `sha256:${"8".repeat(64)}`,
      health: { timeoutMs: 2_000 },
      compose: {
        image: `ghcr.io/avermate/speech-sidecar:v1@${imageDigest}`,
        containerPort: 8_080,
      },
    };
    const next = structuredClone(session.config);
    next.capabilities.sidecars = [sidecar as never];
    const cookie = stored.headers.get("set-cookie")!;
    const csrf = stored.headers.get("x-csrf-token")!;
    const preview = await daemon.fetch(
      request("/api/setup/deployment/preview", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie,
        csrf,
        body: next,
      }),
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { composeOverride: string };
    expect(previewBody.composeOverride).toContain(
      'NODE_CAPABILITY_PROTOCOL_V1: "true"',
    );
    expect(previewBody.composeOverride).toContain("  speech-sidecar:");
    expect(previewBody.composeOverride).toContain(
      `image: ghcr.io/avermate/speech-sidecar:v1@${imageDigest}`,
    );
    expect(previewBody.composeOverride).not.toContain("127.0.0.1:8080");
    expect(
      (parse(previewBody.composeOverride) as {
        services: Record<string, unknown>;
      }).services["speech-sidecar"],
    ).toBeDefined();
    expect(JSON.stringify(previewBody)).not.toContain(rawSecret);
    expect(JSON.stringify(previewBody)).not.toContain("secret:");

    const applied = await daemon.fetch(
      request("/api/setup/config/apply", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie,
        csrf,
        body: next,
      }),
    );
    expect(applied.status).toBe(200);
    expect(await applied.text()).not.toContain("secret:");
    const persisted = await loadNodeConfig(join(root, "avermate-node.yaml"));
    expect(persisted.capabilities.sidecars[0]?.secretRef).toMatch(
      /^secret:setup-sidecar-[a-f0-9]{12}-[a-f0-9]{12}$/u,
    );
  });
});
