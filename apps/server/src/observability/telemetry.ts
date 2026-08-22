import { safeOperationalMetadata } from "./redaction";

export type OperationalSignal = {
  kind: "trace" | "metric" | "log";
  name: string;
  correlationId: string;
  accountId?: string;
  runId?: string;
  jobId?: string;
  attributes: Record<string, unknown>;
  occurredAt: string;
};

export interface OperationalExporter {
  emit(signal: OperationalSignal): void | Promise<void>;
}

export const noOperationalExporter: OperationalExporter = {
  emit() {},
};

/**
 * Vendor-neutral, privacy-minimized signal boundary. An OpenTelemetry exporter
 * can consume these records, while self-host defaults to the no-op exporter.
 */
export class ManagedTelemetry {
  constructor(
    private readonly exporter: OperationalExporter = noOperationalExporter,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async emit(
    signal: Omit<OperationalSignal, "occurredAt" | "attributes"> & {
      attributes?: Record<string, unknown>;
    },
  ) {
    await this.exporter.emit({
      ...signal,
      attributes: safeOperationalMetadata(signal.attributes ?? {}) as Record<
        string,
        unknown
      >,
      occurredAt: this.clock().toISOString(),
    });
  }

  async span<T>(
    input: Omit<OperationalSignal, "kind" | "occurredAt" | "attributes"> & {
      attributes?: Record<string, unknown>;
    },
    operation: () => Promise<T>,
  ): Promise<T> {
    const started = this.clock().getTime();
    try {
      const result = await operation();
      await this.emit({
        ...input,
        kind: "trace",
        attributes: {
          ...input.attributes,
          outcome: "ok",
          durationMs: Math.max(0, this.clock().getTime() - started),
        },
      });
      return result;
    } catch (error) {
      await this.emit({
        ...input,
        kind: "trace",
        attributes: {
          ...input.attributes,
          outcome: "error",
          errorClass: error instanceof Error ? error.name : "UnknownError",
          durationMs: Math.max(0, this.clock().getTime() - started),
        },
      });
      throw error;
    }
  }
}
