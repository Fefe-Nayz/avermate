import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultDevZeroConfig } from "./config";
import { ConfiguratorSecurity } from "./configurator-security";
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

describe("local configurator security", () => {
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

    const noCsrf = await daemon.fetch(
      request("/api/setup/pairing-code", {
        method: "POST",
        origin: "http://127.0.0.1:51881",
        cookie,
        body: {},
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
        body: {},
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
});
