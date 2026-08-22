import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { canonicalDigest } from "./canonical-json";

export const nodeProfileSchema = z.enum([
  "dev-zero",
  "node-lite",
  "node-storage",
  "node-creator",
  "node-local-gpu",
  "node-observable",
  "full-self-host",
]);
export type NodeProfile = z.infer<typeof nodeProfileSchema>;

const loopbackHostSchema = z
  .string()
  .refine(
    (host) =>
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      (isIP(host) !== 0 && host.startsWith("127.")),
    "the initial configurator is loopback-only",
  );

export const nodeConfigSchema = z
  .strictObject({
    version: z.literal(1),
    profile: nodeProfileSchema,
    bind: z.strictObject({
      host: loopbackHostSchema,
      port: z.number().int().min(1_024).max(65_535),
    }),
    dataDir: z.string().min(1).max(4_096),
    storage: z.strictObject({
      driver: z.enum(["filesystem", "s3"]),
      filesystemRoot: z.string().min(1).max(4_096).optional(),
      s3SecretRef: z.string().min(1).max(256).optional(),
      maxObjectBytes: z.number().int().positive(),
      quotaBytes: z.number().int().positive(),
    }),
    relay: z.strictObject({
      coreUrl: z.url().startsWith("https://").optional(),
      credentialSecretRef: z.string().min(1).max(256).optional(),
    }),
    models: z.strictObject({
      enabled: z.boolean(),
      providerSecretRefs: z.array(z.string().min(1).max(256)).max(32),
    }),
    sandbox: z.strictObject({
      enabled: z.boolean(),
      provider: z.enum(["disabled", "opensandbox", "microsandbox"]),
    }),
    telemetry: z.strictObject({
      enabled: z.boolean(),
      endpoint: z.url().startsWith("https://").optional(),
    }),
  })
  .superRefine((config, context) => {
    if (
      config.storage.driver === "filesystem" &&
      !config.storage.filesystemRoot
    ) {
      context.addIssue({
        code: "custom",
        path: ["storage", "filesystemRoot"],
        message: "filesystem storage requires filesystemRoot",
      });
    }
    if (config.storage.driver === "s3" && !config.storage.s3SecretRef) {
      context.addIssue({
        code: "custom",
        path: ["storage", "s3SecretRef"],
        message: "S3 storage requires an external secret reference",
      });
    }
    if (
      config.profile === "dev-zero" &&
      config.storage.driver !== "filesystem"
    ) {
      context.addIssue({
        code: "custom",
        path: ["storage", "driver"],
        message: "dev-zero intentionally uses filesystem storage",
      });
    }
    if (!config.sandbox.enabled && config.sandbox.provider !== "disabled") {
      context.addIssue({
        code: "custom",
        path: ["sandbox", "provider"],
        message: "a disabled sandbox must use the disabled provider",
      });
    }
    if (
      Boolean(config.relay.coreUrl) !==
      Boolean(config.relay.credentialSecretRef)
    ) {
      context.addIssue({
        code: "custom",
        path: ["relay"],
        message:
          "relay coreUrl and credentialSecretRef must be configured together",
      });
    }
  });
export type NodeConfig = z.infer<typeof nodeConfigSchema>;

export function defaultDevZeroConfig(baseDir = ".data/node"): NodeConfig {
  return nodeConfigSchema.parse({
    version: 1,
    profile: "dev-zero",
    bind: { host: "127.0.0.1", port: 5_188 },
    dataDir: baseDir,
    storage: {
      driver: "filesystem",
      filesystemRoot: `${baseDir}/objects`,
      maxObjectBytes: 512 * 1024 * 1024,
      quotaBytes: 20 * 1024 * 1024 * 1024,
    },
    relay: {},
    models: { enabled: false, providerSecretRefs: [] },
    sandbox: { enabled: false, provider: "disabled" },
    telemetry: { enabled: false },
  });
}

export function publicConfig(input: NodeConfig) {
  return {
    version: input.version,
    profile: input.profile,
    bind: input.bind,
    dataDir: input.dataDir,
    storage: {
      driver: input.storage.driver,
      ...(input.storage.filesystemRoot
        ? { filesystemRoot: input.storage.filesystemRoot }
        : {}),
      ...(input.storage.s3SecretRef ? { s3SecretRef: "configured" } : {}),
      maxObjectBytes: input.storage.maxObjectBytes,
      quotaBytes: input.storage.quotaBytes,
    },
    relay: {
      ...(input.relay.coreUrl ? { coreUrl: input.relay.coreUrl } : {}),
      ...(input.relay.credentialSecretRef
        ? { credentialSecretRef: "configured" }
        : {}),
    },
    models: {
      ...input.models,
      providerSecretRefs: input.models.providerSecretRefs.map(
        () => "configured",
      ),
    },
    sandbox: input.sandbox,
    telemetry: {
      enabled: input.telemetry.enabled,
      ...(input.telemetry.endpoint
        ? { endpoint: input.telemetry.endpoint }
        : {}),
    },
  };
}

export function configRevision(input: NodeConfig) {
  return canonicalDigest(publicConfig(input));
}

export function serializeNodeConfig(input: NodeConfig) {
  return stringify(nodeConfigSchema.parse(input), { lineWidth: 100 });
}

export async function loadNodeConfig(path?: string): Promise<NodeConfig> {
  const target = path ?? process.env.AVERMATE_NODE_CONFIG;
  if (!target) return defaultDevZeroConfig();
  const body = await readFile(resolve(target), "utf8");
  return nodeConfigSchema.parse(parse(body));
}
