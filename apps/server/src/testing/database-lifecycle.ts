import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

type CloseableClient = {
  close(): void;
};

type CleanupOptions = {
  directories?: string[];
  files?: string[];
};

const clients = new Set<CloseableClient>();
const directories = new Set<string>();
const files = new Set<string>();
let exitHookInstalled = false;

function verifiedTemporaryPath(target: string) {
  const temporaryRoot = resolve(tmpdir());
  const absoluteTarget = resolve(target);
  const relativeTarget = relative(temporaryRoot, absoluteTarget);

  if (
    relativeTarget === "" ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error(
      `Refusing to register a test database cleanup outside ${temporaryRoot}: ${absoluteTarget}`,
    );
  }

  return absoluteTarget;
}

/**
 * The application database is a process-wide singleton. Bun runs test files in
 * one process, so an individual suite must never close that client in its own
 * `afterAll`: later suites still own references to it. Registering it here
 * closes every distinct client once, after the complete test process is done,
 * and then removes only explicitly verified paths below the OS temp directory.
 *
 * A directly executed integration test gets the same cleanup semantics without
 * guessing whether it was selected through CLI arguments.
 */
export function registerSharedTestDatabaseLifecycle(
  client: CloseableClient,
  cleanup: CleanupOptions = {},
) {
  clients.add(client);
  for (const directory of cleanup.directories ?? []) {
    directories.add(verifiedTemporaryPath(directory));
  }
  for (const file of cleanup.files ?? []) {
    files.add(verifiedTemporaryPath(file));
  }

  if (exitHookInstalled) return;
  exitHookInstalled = true;

  process.once("exit", () => {
    for (const registeredClient of clients) registeredClient.close();

    for (const file of files) {
      rmSync(file, { force: true, maxRetries: 5, retryDelay: 20 });
    }
    for (const directory of directories) {
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 20,
      });
    }
  });
}
