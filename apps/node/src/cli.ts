import { resolve } from "node:path";
import {
  loadNodeConfig,
  nodeConfigSchema,
  publicConfig,
} from "./config";
import { createNodeDaemon } from "./daemon";
import { rotateNodeIdentity } from "./identity-lifecycle";
import {
  createNodeBackup,
  generateBackupKey,
  planNodeBackup,
  planNodeRestore,
  readBackupKey,
  restoreNodeBackup,
  verifyNodeBackup,
  verifyNodeRestore,
} from "./lifecycle";
import { runHostPreflight } from "./preflight";
import {
  applyNodeUpgrade,
  buildReleaseBundle,
  importReleaseBundle,
  planNodeUpgrade,
  releaseBundleBuildMetadataSchema,
  verifyNodeUpgrade,
  verifyReleaseBundle,
} from "./release-lifecycle";

const usage = `Avermate Node lifecycle CLI

  doctor [--json] [--config PATH]
  backup keygen --key-file PATH
  backup plan --config PATH
  backup create --config PATH --key-file PATH [--output PATH]
  backup verify --archive PATH --key-file PATH
  restore plan|apply|verify --archive PATH --key-file PATH
      --target-data-dir PATH --target-config PATH
  bundle create --source-dir PATH --output-dir PATH --metadata PATH
      --private-key PATH
  bundle verify --bundle-dir PATH --public-key PATH
  bundle import --bundle-dir PATH --public-key PATH --target-dir PATH
  upgrade plan --config PATH --bundle-dir PATH --public-key PATH
  upgrade apply --config PATH --bundle-dir PATH --public-key PATH
      --key-file PATH [--backup-output PATH]
  upgrade verify --config PATH [--public-key PATH]
  config validate|show-redacted [--config PATH]
  identity rotate --config PATH --confirm-node-id ID
      --confirm-fingerprint FINGERPRINT --key-file PATH [--backup-output PATH]

The CLI never runs arbitrary shell or Docker commands. Upgrade verification
remains failed until the signed Core migration and live capability gates pass.`;

type ParsedArguments = {
  positionals: string[];
  options: Map<string, string | true>;
};

function parseArguments(argv: readonly string[]): ParsedArguments {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    if (equals > 2) {
      options.set(argument.slice(2, equals), argument.slice(equals + 1));
      continue;
    }
    const key = argument.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options.set(key, next);
      index += 1;
    } else {
      options.set(key, true);
    }
  }
  return { positionals, options };
}

function option(arguments_: ParsedArguments, name: string) {
  const value = arguments_.options.get(name);
  return typeof value === "string" && value ? value : undefined;
}

function requiredOption(arguments_: ParsedArguments, name: string) {
  const value = option(arguments_, name);
  if (!value) throw new Error(`CLI_OPTION_REQUIRED:${name}`);
  return value;
}

function configPath(arguments_: ParsedArguments, required = false) {
  const path = option(arguments_, "config") ?? process.env.AVERMATE_NODE_CONFIG;
  if (required && !path) throw new Error("CLI_OPTION_REQUIRED:config");
  return path;
}

async function configInput(arguments_: ParsedArguments, required = false) {
  const path = configPath(arguments_, required);
  return {
    config: await loadNodeConfig(path),
    configPath: path ? resolve(path) : "<defaults>",
  };
}

async function keyInput(arguments_: ParsedArguments) {
  const path =
    option(arguments_, "key-file") ??
    process.env.AVERMATE_NODE_BACKUP_KEY_FILE;
  if (!path) throw new Error("CLI_OPTION_REQUIRED:key-file");
  return readBackupKey(path);
}

function defaultBackupOutput(
  config: Awaited<ReturnType<typeof loadNodeConfig>>,
) {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return resolve(
    config.lifecycle.backupDir,
    `node-backup-${timestamp}.avnb`,
  );
}

async function doctor(arguments_: ParsedArguments) {
  const input = await configInput(arguments_);
  const daemon = await createNodeDaemon({
    config: input.config,
    ...(input.configPath === "<defaults>"
      ? {}
      : { configPath: input.configPath }),
  });
  const [manifest, preflight, storage] = await Promise.all([
    daemon.manifest(),
    runHostPreflight({
      profile: daemon.config.profile,
      dataDir: resolve(daemon.config.dataDir),
    }),
    daemon.storage.capabilities(),
  ]);
  const feature = manifest.features;
  return {
    ok: preflight.ready,
    profile: daemon.config.profile,
    protocol: "avermate-node/2",
    nodeId: daemon.identity.nodeId,
    configRevision: manifest.configRevision,
    preflight,
    capabilities: {
      storage: { available: true, ...storage },
      conversations: {
        available: Boolean(feature.conversations),
        reason: feature.conversations ? null : "DISABLED_BY_CONFIG",
      },
      retrieval: {
        available: Boolean(feature.retrieval),
        lexical: feature.retrieval?.lexical ?? false,
        providers: feature.retrieval?.providers ?? [],
        reason: feature.retrieval ? null : "DISABLED_BY_CONFIG",
      },
      models: {
        available: Boolean(feature.models),
        reason: feature.models ? null : "GATEWAY_NOT_CONFIGURED",
      },
      sandbox: {
        available: Boolean(feature.sandbox),
        runtimeCheckpoints: feature.sandbox?.runtimeCheckpoints ?? false,
        reason: feature.sandbox
          ? null
          : "PROVIDER_NOT_INJECTED_OR_DISABLED",
      },
      jobs: {
        available: Boolean(feature.jobs),
        kinds: feature.jobs?.kinds ?? [],
        reason: feature.jobs ? null : "NO_REVIEWED_HANDLERS_REGISTERED",
      },
    },
  };
}

async function backup(arguments_: ParsedArguments, action?: string) {
  if (action === "keygen") {
    return generateBackupKey(requiredOption(arguments_, "key-file"));
  }
  if (action === "verify") {
    return verifyNodeBackup({
      archivePath: requiredOption(arguments_, "archive"),
      key: await keyInput(arguments_),
    });
  }
  const input = await configInput(arguments_, true);
  if (action === "plan") return planNodeBackup(input);
  if (action === "create") {
    return createNodeBackup({
      ...input,
      outputPath:
        option(arguments_, "output") ?? defaultBackupOutput(input.config),
      key: await keyInput(arguments_),
    });
  }
  throw new Error("CLI_BACKUP_ACTION_INVALID");
}

function restoreInput(arguments_: ParsedArguments) {
  return {
    archivePath: requiredOption(arguments_, "archive"),
    targetDataDir: requiredOption(arguments_, "target-data-dir"),
    targetConfigPath: requiredOption(arguments_, "target-config"),
  };
}

async function restore(arguments_: ParsedArguments, action?: string) {
  const input = {
    ...restoreInput(arguments_),
    key: await keyInput(arguments_),
  };
  if (action === "plan") return planNodeRestore(input);
  if (action === "apply") return restoreNodeBackup(input);
  if (action === "verify") return verifyNodeRestore(input);
  throw new Error("CLI_RESTORE_ACTION_INVALID");
}

async function config(arguments_: ParsedArguments, action?: string) {
  const input = await configInput(arguments_);
  if (action === "validate") {
    const config = nodeConfigSchema.parse(input.config);
    return {
      valid: true,
      configPath: input.configPath,
      profile: config.profile,
    };
  }
  if (action === "show-redacted") return publicConfig(input.config);
  throw new Error("CLI_CONFIG_ACTION_INVALID");
}

function releasePublicKey(
  arguments_: ParsedArguments,
  config?: Awaited<ReturnType<typeof loadNodeConfig>>,
) {
  const path =
    option(arguments_, "public-key") ??
    config?.lifecycle.releaseSigningPublicKeyPath;
  if (!path) throw new Error("CLI_OPTION_REQUIRED:public-key");
  return path;
}

async function bundle(arguments_: ParsedArguments, action?: string) {
  if (action === "create") {
    const metadataPath = resolve(requiredOption(arguments_, "metadata"));
    return buildReleaseBundle({
      sourceDir: requiredOption(arguments_, "source-dir"),
      outputDir: requiredOption(arguments_, "output-dir"),
      privateKeyPath: requiredOption(arguments_, "private-key"),
      metadata: releaseBundleBuildMetadataSchema.parse(
        JSON.parse(await Bun.file(metadataPath).text()),
      ),
    });
  }
  const input = {
    bundleDir: requiredOption(arguments_, "bundle-dir"),
    publicKeyPath: releasePublicKey(arguments_),
  };
  if (action === "verify") return verifyReleaseBundle(input);
  if (action === "import") {
    return importReleaseBundle({
      ...input,
      targetDir: requiredOption(arguments_, "target-dir"),
    });
  }
  throw new Error("CLI_BUNDLE_ACTION_INVALID");
}

async function upgrade(arguments_: ParsedArguments, action?: string) {
  const input = await configInput(arguments_, true);
  const publicKeyPath = releasePublicKey(arguments_, input.config);
  if (action === "verify") {
    const verified = await verifyNodeUpgrade({
      config: input.config,
      publicKeyPath,
    });
    if (!verified.trafficReady) {
      throw new Error(verified.reason);
    }
    return verified;
  }
  const bundleDir = requiredOption(arguments_, "bundle-dir");
  if (action === "plan") {
    return planNodeUpgrade({
      config: input.config,
      bundleDir,
      publicKeyPath,
    });
  }
  if (action === "apply") {
    return applyNodeUpgrade({
      ...input,
      bundleDir,
      publicKeyPath,
      backupPath:
        option(arguments_, "backup-output") ??
        defaultBackupOutput(input.config),
      backupKey: await keyInput(arguments_),
    });
  }
  throw new Error("CLI_UPGRADE_ACTION_INVALID");
}

async function identity(arguments_: ParsedArguments, action?: string) {
  if (action !== "rotate") throw new Error("CLI_IDENTITY_ACTION_INVALID");
  const input = await configInput(arguments_, true);
  return rotateNodeIdentity({
    ...input,
    confirmNodeId: requiredOption(arguments_, "confirm-node-id"),
    confirmFingerprint: requiredOption(arguments_, "confirm-fingerprint"),
    backupPath:
      option(arguments_, "backup-output") ?? defaultBackupOutput(input.config),
    backupKey: await keyInput(arguments_),
  });
}

export async function runNodeCli(argv: readonly string[]) {
  const arguments_ = parseArguments(argv);
  const [command = "doctor", action] = arguments_.positionals;
  if (command === "doctor") return doctor(arguments_);
  if (command === "backup") return backup(arguments_, action);
  if (command === "restore") return restore(arguments_, action);
  if (command === "bundle") return bundle(arguments_, action);
  if (command === "upgrade") return upgrade(arguments_, action);
  if (command === "config") return config(arguments_, action);
  if (command === "identity") return identity(arguments_, action);
  if (command === "help" || arguments_.options.has("help")) {
    return { usage };
  }
  throw new Error("CLI_COMMAND_INVALID");
}

if (import.meta.main) {
  try {
    const result = await runNodeCli(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "NODE_CLI_FAILED",
      }),
    );
    console.error(usage);
    process.exitCode = 1;
  }
}
