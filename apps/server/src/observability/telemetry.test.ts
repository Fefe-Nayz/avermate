import { describe, expect, test } from "bun:test";
import {
  ManagedTelemetry,
  noOperationalExporter,
  type OperationalSignal,
} from "./telemetry";

describe("managed operational signal boundary", () => {
  test("emits only redacted metadata with a deterministic correlation id", async () => {
    const signals: OperationalSignal[] = [];
    const telemetry = new ManagedTelemetry(
      {
        emit(signal) {
          signals.push(signal);
        },
      },
      () => new Date("2026-08-22T12:00:00.000Z"),
    );
    await telemetry.emit({
      kind: "metric",
      name: "managed.reservation.completed",
      correlationId: "correlation-1",
      runId: "run-1",
      attributes: {
        capability: "ocr.pages",
        prompt: "private school content",
        authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
      },
    });
    expect(signals).toEqual([
      expect.objectContaining({
        correlationId: "correlation-1",
        occurredAt: "2026-08-22T12:00:00.000Z",
        attributes: {
          capability: "ocr.pages",
          prompt: "[REDACTED]",
          authorization: "[REDACTED]",
        },
      }),
    ]);
  });

  test("self-host no-op export remains an explicit valid configuration", async () => {
    const telemetry = new ManagedTelemetry(noOperationalExporter);
    await expect(
      telemetry.span(
        {
          name: "selfhost.local-operation",
          correlationId: "correlation-local",
        },
        async () => "ok",
      ),
    ).resolves.toBe("ok");
  });
});
