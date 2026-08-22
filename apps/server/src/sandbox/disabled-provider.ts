import type {
  SandboxCapabilities,
  SandboxCreateInput,
  SandboxExecuteInput,
  SandboxExecutionEvent,
  SandboxFileManifestEntry,
  SandboxHandle,
  SandboxInputFile,
  SandboxPreflightInput,
  SandboxPreflightResult,
  SandboxProvider,
  SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import { SandboxUnavailableError } from "./errors";

export class DisabledSandboxProvider implements SandboxProvider {
  readonly id = "disabled" as const;

  async capabilities(): Promise<SandboxCapabilities> {
    return { providerId: this.id, available: false, profiles: [] };
  }

  async preflight(_input: SandboxPreflightInput): Promise<SandboxPreflightResult> {
    return {
      ok: false,
      reason: "PROVIDER_DISABLED",
      message: "Sandbox execution is disabled. No code was executed.",
    };
  }

  async create(_input: SandboxCreateInput): Promise<SandboxHandle> {
    return this.unavailable();
  }

  execute(_input: SandboxExecuteInput): AsyncIterable<SandboxExecutionEvent> {
    return this.unavailableStream();
  }

  async putFiles(_handle: SandboxHandle, _files: readonly SandboxInputFile[]): Promise<void> {
    return this.unavailable();
  }

  async getFiles(
    _handle: SandboxHandle,
    _paths: readonly string[],
  ): Promise<readonly SandboxFileManifestEntry[]> {
    return this.unavailable();
  }

  readFile(
    _handle: SandboxHandle,
    _relativePath: string,
  ): AsyncIterable<Uint8Array> {
    return this.unavailableStream();
  }

  async snapshotWorkspace(_handle: SandboxHandle): Promise<SandboxWorkspaceSnapshotRef> {
    return this.unavailable();
  }

  async forkWorkspace(
    _input: SandboxCreateInput & { source: SandboxWorkspaceSnapshotRef },
  ): Promise<SandboxHandle> {
    return this.unavailable();
  }

  async stop(_handle: SandboxHandle): Promise<void> {
    return this.unavailable();
  }

  async destroy(_handle: SandboxHandle): Promise<void> {
    return this.unavailable();
  }

  private unavailable<T>(): T {
    throw new SandboxUnavailableError(
      "PROVIDER_DISABLED",
      "Sandbox execution is disabled. Configure and prove a provider before enabling a profile.",
    );
  }

  private unavailableStream<T>(): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => this.unavailable<IteratorResult<T>>(),
      }),
    };
  }
}
