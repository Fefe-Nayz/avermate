import type {
  SandboxCapabilities,
  SandboxCreateInput,
  SandboxExecuteInput,
  SandboxExecutionEvent,
  SandboxHandle,
  SandboxInputFile,
  SandboxPreflightInput,
  SandboxPreflightResult,
  SandboxProvider,
  SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import type { UsageLedger } from "../usage/ledger";

const managedIsolation = new Set(["kata-multitenant", "e2b-managed"]);
const sensitiveEnvironmentName =
  /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION|COOKIE|API_?KEY|PRIVATE_?KEY)/iu;

type Reservations = {
  accountId: string;
  cpu: string;
  memory: string;
  egress: string;
};

/**
 * Managed isolation gate around the plan-031 provider contract. Development
 * runc/gVisor-personal evidence can never become hosted untrusted execution.
 */
export class ManagedSandboxProvider implements SandboxProvider {
  readonly id;
  readonly #reservations = new Map<string, Reservations>();
  readonly #owners = new Map<string, string>();

  constructor(
    private readonly delegate: SandboxProvider,
    private readonly usage: UsageLedger,
    private readonly managedProviderId: string,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.id = delegate.id;
  }

  async capabilities(): Promise<SandboxCapabilities> {
    const capabilities = await this.delegate.capabilities();
    const profiles = capabilities.profiles.filter((profile) =>
      managedIsolation.has(profile.isolationClass),
    );
    return { ...capabilities, available: capabilities.available && profiles.length > 0, profiles };
  }

  async preflight(input: SandboxPreflightInput): Promise<SandboxPreflightResult> {
    const result = await this.delegate.preflight(input);
    if (!result.ok) return result;
    if (!managedIsolation.has(result.evidence.isolationClass)) {
      return {
        ok: false,
        reason: "ISOLATION_NOT_ALLOWED",
        message: "Hosted untrusted execution requires Kata/microVM-class evidence.",
      };
    }
    return result;
  }

  async create(input: SandboxCreateInput): Promise<SandboxHandle> {
    return this.#create(input);
  }

  async #create(
    input: SandboxCreateInput,
    source?: SandboxWorkspaceSnapshotRef,
  ): Promise<SandboxHandle> {
    if (!input.operationId) throw new Error("MANAGED_OPERATION_ID_REQUIRED");
    const preflight = await this.preflight(input);
    if (!preflight.ok) throw new Error(`MANAGED_SANDBOX_DISABLED:${preflight.reason}`);
    const expiry = new Date(
      Math.min(
        input.expiresAt.getTime(),
        this.clock().getTime() + input.profile.resources.wallTimeMs + 15 * 60_000,
      ),
    );
    const common = {
      accountId: input.ownerId,
      userId: input.ownerId,
      placement: { kind: "managed" as const, providerId: this.managedProviderId },
      provider: this.delegate.id,
      expiresAt: expiry,
      estimatorVersion: `sandbox-profile:${input.profile.version}`,
    };
    const created: { reservation: { id: string } }[] = [];
    try {
      created.push(
        await this.usage.reserve({
          ...common,
          capability: "sandbox.cpuMillis",
          unit: "cpu-milliseconds",
          maximumQuantity: String(input.profile.resources.cpuMillis),
          idempotencyKey: `sandbox:${input.operationId}:cpu`,
        }),
      );
      created.push(
        await this.usage.reserve({
          ...common,
          capability: "sandbox.memoryByteSeconds",
          unit: "memory-byte-seconds",
          maximumQuantity: (
            BigInt(input.profile.resources.memoryBytes) *
            BigInt(Math.ceil(input.profile.resources.wallTimeMs / 1_000))
          ).toString(),
          idempotencyKey: `sandbox:${input.operationId}:memory`,
        }),
      );
      created.push(
        await this.usage.reserve({
          ...common,
          capability: "sandbox.egressBytes",
          unit: "egress-bytes",
          maximumQuantity: String(input.profile.resources.networkBytes),
          idempotencyKey: `sandbox:${input.operationId}:egress`,
        }),
      );
    } catch (error) {
      await Promise.all(
        created.map((item) =>
          this.usage.settle({
            accountId: input.ownerId,
            reservationId: item.reservation.id,
            actualQuantity: "0",
            outcome: "cancelled",
            authoritative: true,
            provider: this.delegate.id,
          }),
        ),
      );
      throw error;
    }
    let handle: SandboxHandle;
    try {
      handle = source
        ? await this.delegate.forkWorkspace({ ...input, source })
        : await this.delegate.create(input);
    } catch (error) {
      // The sandbox was not created, therefore no compute was consumed through
      // this provider contract. Release all pre-dispatch reservations.
      await Promise.all(
        created.map((item) =>
          this.usage.settle({
            accountId: input.ownerId,
            reservationId: item.reservation.id,
            actualQuantity: "0",
            outcome: "failed",
            authoritative: true,
            provider: this.delegate.id,
          }),
        ),
      );
      throw error;
    }
    this.#reservations.set(handle.sandboxId, {
      accountId: input.ownerId,
      cpu: created[0]!.reservation.id,
      memory: created[1]!.reservation.id,
      egress: created[2]!.reservation.id,
    });
    this.#owners.set(handle.sandboxId, handle.ownerId);
    return handle;
  }

  async *execute(input: SandboxExecuteInput): AsyncIterable<SandboxExecutionEvent> {
    this.#assertOwner(input.handle);
    if (
      input.environment &&
      Object.keys(input.environment).some((name) => sensitiveEnvironmentName.test(name))
    ) {
      throw new Error("RAW_SECRET_ENVIRONMENT_FORBIDDEN");
    }
    yield* this.delegate.execute(input);
  }

  putFiles(handle: SandboxHandle, files: readonly SandboxInputFile[]) {
    this.#assertOwner(handle);
    return this.delegate.putFiles(handle, files);
  }

  getFiles(handle: SandboxHandle, paths: readonly string[]) {
    this.#assertOwner(handle);
    return this.delegate.getFiles(handle, paths);
  }

  readFile(handle: SandboxHandle, relativePath: string) {
    this.#assertOwner(handle);
    return this.delegate.readFile(handle, relativePath);
  }

  snapshotWorkspace(handle: SandboxHandle): Promise<SandboxWorkspaceSnapshotRef> {
    this.#assertOwner(handle);
    return this.delegate.snapshotWorkspace(handle);
  }

  forkWorkspace(
    input: SandboxCreateInput & { source: SandboxWorkspaceSnapshotRef },
  ) {
    return this.#create(input, input.source);
  }

  stop(handle: SandboxHandle) {
    this.#assertOwner(handle);
    return this.delegate.stop(handle);
  }

  async destroy(handle: SandboxHandle) {
    this.#assertOwner(handle);
    await this.delegate.destroy(handle);
    this.#owners.delete(handle.sandboxId);
  }

  async settle(
    handle: SandboxHandle,
    usage: {
      cpuMillis: string;
      memoryByteSeconds: string;
      egressBytes: string;
      authoritative: boolean;
      outcome: "completed" | "failed" | "cancelled";
    },
  ) {
    this.#assertOwner(handle);
    const reservations = this.#reservations.get(handle.sandboxId);
    if (!reservations) throw new Error("SANDBOX_RESERVATIONS_NOT_FOUND");
    await Promise.all([
      this.usage.settle({
        accountId: reservations.accountId,
        reservationId: reservations.cpu,
        actualQuantity: usage.cpuMillis,
        outcome: usage.outcome,
        authoritative: usage.authoritative,
        provider: this.delegate.id,
      }),
      this.usage.settle({
        accountId: reservations.accountId,
        reservationId: reservations.memory,
        actualQuantity: usage.memoryByteSeconds,
        outcome: usage.outcome,
        authoritative: usage.authoritative,
        provider: this.delegate.id,
      }),
      this.usage.settle({
        accountId: reservations.accountId,
        reservationId: reservations.egress,
        actualQuantity: usage.egressBytes,
        outcome: usage.outcome,
        authoritative: usage.authoritative,
        provider: this.delegate.id,
      }),
    ]);
    this.#reservations.delete(handle.sandboxId);
  }

  #assertOwner(handle: SandboxHandle) {
    const owner = this.#owners.get(handle.sandboxId);
    if (!owner || owner !== handle.ownerId) {
      throw new Error("SANDBOX_TENANT_MISMATCH");
    }
  }
}
