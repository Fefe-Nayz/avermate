import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { runDeployedFullSelfHostFlow } from "./plan-032-deployed-flow";
import { runCaptured, runChecked, workspaceRoot } from "./plan-032-lib";

const composeFile = "infra/compose/avermate.yml";

export async function assertSelfHostSourceIsolation() {
  const [dockerfile, compose] = await Promise.all([
    Bun.file(resolve(workspaceRoot, "apps/web/Dockerfile")).text(),
    Bun.file(resolve(workspaceRoot, composeFile)).text(),
  ]);
  if (/(?:avermate|nayz)\.fr/iu.test(dockerfile)) {
    throw new Error("PLAN032_HOSTED_DEPENDENCY_IN_WEB_DOCKERFILE");
  }
  for (const expected of [
    "ARG NEXT_PUBLIC_API_URL=http://127.0.0.1:5000",
    "ARG NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000",
  ]) {
    if (!dockerfile.includes(expected)) {
      throw new Error(`PLAN032_SELF_HOST_BUILD_ARG_MISSING:${expected}`);
    }
  }
  for (const expected of [
    "AVERMATE_DEPLOYMENT_MODE: full-self-host",
    'MANAGED_ADAPTERS_ENABLED: "false"',
    "full-self-host-internal:",
    "internal: true",
  ]) {
    if (!compose.includes(expected)) {
      throw new Error(`PLAN032_SELF_HOST_COMPOSE_BOUNDARY_MISSING:${expected}`);
    }
  }

  const findings: string[] = [];
  for await (const path of new Bun.Glob(
    "{src,messages}/**/*.{js,json,jsx,mjs,ts,tsx}",
  ).scan({
    cwd: resolve(workspaceRoot, "apps/web"),
    absolute: true,
    onlyFiles: true,
  })) {
    if (/(?:avermate|nayz)\.fr/iu.test(await Bun.file(path).text())) {
      findings.push(path);
    }
  }
  if (findings.length > 0) {
    throw new Error(
      `PLAN032_HOSTED_DEPENDENCY_IN_WEB_SOURCE:${findings.slice(0, 20).join(",")}`,
    );
  }
  console.log(
    "[plan-032] self-host source isolation PASS (loopback build args, internal network, no hosted domain in Web source)",
  );
}

function composeCommand(project: string, profile: string, ...args: string[]) {
  return [
    "docker",
    "compose",
    "-f",
    composeFile,
    "--profile",
    profile,
    "--project-name",
    project,
    ...args,
  ];
}

export async function availableLoopbackPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("PLAN032_LOOPBACK_PORT_UNAVAILABLE"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function assertProjectRemoved(project: string) {
  for (const [kind, args] of [
    [
      "containers",
      [
        "docker",
        "ps",
        "--all",
        "--quiet",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ],
    ],
    [
      "volumes",
      [
        "docker",
        "volume",
        "ls",
        "--quiet",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ],
    ],
    [
      "networks",
      [
        "docker",
        "network",
        "ls",
        "--quiet",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ],
    ],
  ] as const) {
    const result = await runCaptured(`audit ${project} ${kind} cleanup`, args);
    if (result.stdout.trim()) {
      throw new Error(`PLAN032_COMPOSE_CLEANUP_INCOMPLETE:${project}:${kind}`);
    }
  }
}

async function removeProject(
  project: string,
  profile: string,
  env: Record<string, string>,
) {
  await runChecked(
    `remove ${profile} smoke project`,
    composeCommand(project, profile, "down", "--volumes", "--remove-orphans"),
    { env },
  ).catch(() => undefined);
  await assertProjectRemoved(project);
}

export async function smokeNodeProfile(
  profile: string,
  options: { env?: Record<string, string> } = {},
) {
  const project = `plan032-${process.pid}-${profile.replaceAll(/[^a-z0-9]/gu, "")}`;
  const env = options.env ?? {};
  try {
    await runChecked(
      `boot ${profile} Compose`,
      composeCommand(project, profile, "up", "--build", "--detach", "--wait"),
      { env },
    );
    const service =
      profile === "dev-zero"
        ? "node-dev-zero"
        : profile.replace("node-", "node-");
    const health = await runCaptured(
      `read ${profile} runtime health`,
      composeCommand(
        project,
        profile,
        "exec",
        "-T",
        service,
        "wget",
        "-qO-",
        "http://127.0.0.1:5188/health",
      ),
      { env },
    );
    const payload = JSON.parse(health.stdout) as {
      status?: string;
      profile?: string;
      capabilityLimitations?: Record<string, string>;
    };
    if (payload.status !== "ok" || payload.profile !== profile) {
      throw new Error(`PLAN032_PROFILE_HEALTH_MISMATCH:${profile}`);
    }
    console.log(
      `[plan-032] ${profile} limitations=${JSON.stringify(payload.capabilityLimitations ?? {})}`,
    );
  } finally {
    await removeProject(project, profile, env);
  }
}

async function waitForHttp(label: string, url: string) {
  let lastError = "not attempted";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(1_000);
  }
  throw new Error(`PLAN032_HTTP_SMOKE_FAILED:${label}:${lastError}`);
}

const bundleScanScript = String.raw`
const roots = ["/app/apps/web/.next", "/app/apps/web/public"];
const prohibited = [
  /(?:avermate|nayz)\.fr/iu,
  /https?:\\?\/\\?\/[^\s"'\x60]*(?:avermate\.fr|nayz\.fr)/iu,
  /(?:managed|billing|telemetry)\.(?:avermate\.fr|nayz\.fr)/iu,
];
const textSuffix = /\.(?:css|html|js|json|map|mjs|rsc|txt)$/iu;
const findings = [];
for (const root of roots) {
  for await (const path of new Bun.Glob("**/*").scan({ cwd: root, absolute: true, dot: true, onlyFiles: true })) {
    if (!textSuffix.test(path)) continue;
    const body = await Bun.file(path).text();
    for (const pattern of prohibited) {
      if (pattern.test(body)) findings.push(path + ":" + pattern.source);
    }
  }
}
if (findings.length) throw new Error("PLAN032_HOSTED_DEPENDENCY_IN_WEB_BUNDLE:" + findings.slice(0, 20).join(","));
`;

const egressProbeScript = String.raw`
const targets = [
  "https://api.avermate.nayz.fr/health",
  "https://managed.avermate.fr/health",
  "https://billing.avermate.fr/health",
  "https://telemetry.avermate.fr/health",
  "http://1.1.1.1/",
];
const escaped = [];
for (const target of targets) {
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(2_000), redirect: "manual" });
    escaped.push(target + ":HTTP" + response.status);
  } catch {}
}
let dnsEscaped = false;
try {
  await Bun.dns.lookup("api.avermate.nayz.fr");
  dnsEscaped = true;
} catch {}
if (escaped.length || dnsEscaped) {
  throw new Error("PLAN032_EGRESS_BOUNDARY_BYPASSED:" + JSON.stringify({ escaped, dnsEscaped }));
}
console.log(JSON.stringify({ blocked: targets, dnsBlocked: true }));
`;

const seedVerifiedUserScript = String.raw`
const { db } = await import("./src/db");
const schema = await import("./src/db/schema");
const userId = process.env.PLAN032_SMOKE_USER_ID;
const email = process.env.PLAN032_SMOKE_USER_EMAIL;
const password = process.env.PLAN032_SMOKE_USER_PASSWORD;
if (!userId || !email || !password) throw new Error("PLAN032_SMOKE_USER_ENV_MISSING");
const now = new Date();
const passwordHash = await Bun.password.hash(password, "argon2id");
await db.insert(schema.users).values({
  id: userId,
  name: "Plan 032 Self Host",
  email,
  emailVerified: true,
  role: "user",
  banned: false,
  createdAt: now,
  updatedAt: now,
});
await db.insert(schema.accounts).values({
  id: "account-" + userId,
  accountId: userId,
  providerId: "credential",
  issuer: "local:credential",
  userId,
  password: passwordHash,
  createdAt: now,
  updatedAt: now,
});
`;

function assertNoHostedDependency(body: string, surface: string) {
  const hostedUrl =
    /https?:\\?\/\\?\/[^\s"'`]*(?:avermate\.fr|nayz\.fr)|(?:managed|billing|telemetry)\.(?:avermate\.fr|nayz\.fr)/iu;
  if (hostedUrl.test(body) || /(?:avermate|nayz)\.fr/iu.test(body)) {
    throw new Error(`PLAN032_HOSTED_DEPENDENCY_IN_${surface.toUpperCase()}`);
  }
}

async function assertInternalNetworks(
  project: string,
  env: Record<string, string>,
) {
  for (const service of ["api", "web", "node-full"]) {
    const id = await runCaptured(
      `resolve ${service} container`,
      composeCommand(project, "full-self-host", "ps", "--quiet", service),
      { env },
    );
    const containerId = id.stdout.trim();
    if (!containerId) throw new Error(`PLAN032_CONTAINER_MISSING:${service}`);
    const networks = await runCaptured(
      `inspect ${service} networks`,
      [
        "docker",
        "container",
        "inspect",
        containerId,
        "--format",
        "{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}",
      ],
      { env },
    );
    const names = networks.stdout.trim().split(/\s+/u).filter(Boolean);
    if (names.length === 0) {
      throw new Error(`PLAN032_CONTAINER_NETWORK_MISSING:${service}`);
    }
    for (const name of names) {
      const inspected = await runCaptured(
        `verify ${service} internal network ${name}`,
        ["docker", "network", "inspect", name, "--format", "{{.Internal}}"],
        { env },
      );
      if (inspected.stdout.trim() !== "true") {
        throw new Error(`PLAN032_NETWORK_NOT_INTERNAL:${service}:${name}`);
      }
    }
  }
}

async function assertRuntimeConfiguration(
  project: string,
  env: Record<string, string>,
) {
  const apiEnvironment = await runCaptured(
    "inspect full-self-host API environment",
    composeCommand(project, "full-self-host", "exec", "-T", "api", "env"),
    { env },
  );
  for (const required of [
    "AVERMATE_DEPLOYMENT_MODE=full-self-host",
    "MANAGED_ADAPTERS_ENABLED=false",
    "DISABLE_EMAIL=true",
    "DISABLE_JOBS=false",
    "DISABLE_OCR=true",
    "DISABLE_TRANSCRIPTION=true",
    "DISABLE_TTS=true",
    "TECTONIC_ONLY_CACHED=true",
  ]) {
    if (!apiEnvironment.stdout.split(/\r?\n/u).includes(required)) {
      throw new Error(`PLAN032_AIRGAP_ENVIRONMENT_MISSING:${required}`);
    }
  }
  for (const forbiddenSecret of [
    "MISTRAL_API_KEY=",
    "TRANSCRIPTION_API_KEY=",
    "INFERENCE_API_KEY=",
    "RESEND_API_KEY=",
    "STRIPE_SECRET_KEY=",
    "OTEL_EXPORTER_OTLP_ENDPOINT=",
  ]) {
    if (apiEnvironment.stdout.includes(forbiddenSecret)) {
      throw new Error(`PLAN032_MANAGED_SECRET_EXPOSED:${forbiddenSecret}`);
    }
  }
  assertNoHostedDependency(apiEnvironment.stdout, "api_environment");
}

async function proveDeclaredCapabilityLimits(
  project: string,
  env: Record<string, string>,
) {
  const health = await runCaptured(
    "read full-self-host Node capability limits",
    composeCommand(
      project,
      "full-self-host",
      "exec",
      "-T",
      "node-full",
      "wget",
      "-qO-",
      "http://127.0.0.1:5188/health",
    ),
    { env },
  );
  const payload = JSON.parse(health.stdout) as {
    profile?: string;
    capabilityLimitations?: Record<string, string>;
  };
  if (
    payload.profile !== "full-self-host" ||
    payload.capabilityLimitations?.sandbox !== "disabled"
  ) {
    throw new Error("PLAN032_FULL_SELF_HOST_CAPABILITY_LIMIT_MISMATCH");
  }
  console.log(
    "[plan-032] full-self-host sandbox artifact N/A: profile declares sandbox disabled and dispatch remains fail-closed",
  );
}

async function proveDeployedFlows(
  project: string,
  env: Record<string, string>,
  apiUrl: string,
  webUrl: string,
) {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const userId = `u_plan032_${suffix}`;
  const email = `plan032-${suffix}@example.invalid`;
  const password = `Plan032!${randomBytes(24).toString("base64url")}`;
  await runChecked(
    "seed isolated verified self-host account",
    composeCommand(
      project,
      "full-self-host",
      "exec",
      "-T",
      "-e",
      `PLAN032_SMOKE_USER_ID=${userId}`,
      "-e",
      `PLAN032_SMOKE_USER_EMAIL=${email}`,
      "-e",
      `PLAN032_SMOKE_USER_PASSWORD=${password}`,
      "api",
      "bun",
      "-e",
      seedVerifiedUserScript,
    ),
    { env },
  );
  await runDeployedFullSelfHostFlow({ apiUrl, webUrl, email, password });

  const logs = await runCaptured(
    "audit self-host logs for credential disclosure",
    composeCommand(
      project,
      "full-self-host",
      "logs",
      "--no-color",
      "api",
      "web",
      "node-full",
    ),
    { env },
  );
  for (const secret of [
    password,
    env.BETTER_AUTH_SECRET ?? "",
    env.MCP_REQUEST_STATE_SECRET ?? "",
  ]) {
    if (secret && logs.stdout.includes(secret)) {
      throw new Error("PLAN032_SECRET_DISCLOSED_IN_RUNTIME_LOGS");
    }
  }
  if (/OTP\s+[^\r\n]*:\s*\d{6}\b/iu.test(logs.stdout)) {
    throw new Error("PLAN032_OTP_DISCLOSED_IN_RUNTIME_LOGS");
  }
}

export type FullSelfHostEvidence = {
  project: string;
  apiUrl: string;
  webUrl: string;
  env: Record<string, string>;
};

export async function withFullSelfHost(input: {
  label: string;
  verifyEgressBoundary?: boolean;
  action?: (evidence: FullSelfHostEvidence) => Promise<void>;
}) {
  const project = `plan032-${process.pid}-${input.label.replaceAll(/[^a-z0-9]/gu, "")}`;
  const [apiPort, webPort] = await Promise.all([
    availableLoopbackPort(),
    availableLoopbackPort(),
  ]);
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const env = {
    AVERMATE_API_ORIGIN: apiUrl,
    AVERMATE_PUBLIC_ORIGIN: webUrl,
    PLAN032_API_PORT: String(apiPort),
    PLAN032_WEB_PORT: String(webPort),
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    MCP_REQUEST_STATE_SECRET: randomBytes(32).toString("hex"),
    ...(input.verifyEgressBoundary
      ? { PLAN032_EGRESS_PROXY: "http://127.0.0.1:9" }
      : {}),
  };
  try {
    // Build while ordinary build networking is available. The proof starts at
    // `up --no-build`: every runtime service then has only an internal network.
    await runChecked(
      `build ${input.label} images`,
      composeCommand(project, "full-self-host", "build"),
      { env },
    );
    await runChecked(
      `boot ${input.label} on the internal network`,
      composeCommand(
        project,
        "full-self-host",
        "up",
        "--detach",
        "--wait",
        "--no-build",
      ),
      { env },
    );

    await assertInternalNetworks(project, env);
    await assertRuntimeConfiguration(project, env);
    await proveDeclaredCapabilityLimits(project, env);

    const apiResponse = await waitForHttp("api", `${apiUrl}/health`);
    const apiBody = await apiResponse.text();
    if (!/"ok"\s*:\s*true/u.test(apiBody)) {
      throw new Error("PLAN032_FULL_SELF_HOST_API_HEALTH_INVALID");
    }
    assertNoHostedDependency(apiBody, "api_health");

    const webResponse = await waitForHttp("web", `${webUrl}/`);
    const html = await webResponse.text();
    assertNoHostedDependency(html, "web_html");

    await runChecked(
      "prove web-to-api service-network request",
      composeCommand(
        project,
        "full-self-host",
        "exec",
        "-T",
        "web",
        "bun",
        "-e",
        "const r=await fetch('http://api:5000/health');if(!r.ok)throw new Error('PLAN032_INTERNAL_API_UNHEALTHY');const b=await r.json();if(b.ok!==true)throw new Error('PLAN032_INTERNAL_API_BODY_INVALID')",
      ),
      { env },
    );

    await runChecked(
      "scan built web bundle for hosted Avermate dependencies",
      composeCommand(
        project,
        "full-self-host",
        "exec",
        "-T",
        "web",
        "bun",
        "-e",
        bundleScanScript,
      ),
      { env },
    );

    await proveDeployedFlows(project, env, apiUrl, webUrl);

    if (input.verifyEgressBoundary) {
      for (const service of ["api", "web", "node-full"]) {
        await runChecked(
          `prove ${service} DNS/HTTP egress is denied`,
          composeCommand(
            project,
            "full-self-host",
            "exec",
            "-T",
            service,
            "bun",
            "-e",
            egressProbeScript,
          ),
          { env },
        );
      }
    }

    const evidence = { project, apiUrl, webUrl, env };
    await input.action?.(evidence);
    console.log(
      `[plan-032] ${input.label} proof: API=${apiUrl} web=${webUrl} internal-network=true hosted-bundle-dependency=false egress=${input.verifyEgressBoundary ? "denied" : "not-probed"}`,
    );
    return evidence;
  } finally {
    await removeProject(project, "full-self-host", env);
  }
}
