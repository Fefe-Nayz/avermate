import { describe, expect, test } from "bun:test";
import { BoundedStreamLane } from "./stream-lane";

function frame(streamId: string, sequence: number, payload = "x") {
  return {
    streamId,
    runId: `run-${streamId}`,
    sequence,
    ack: 0,
    kind: "event" as const,
    payload,
    terminal: false,
  };
}

describe("bounded high-frequency stream lane", () => {
  test("orders and deduplicates frames per stream", () => {
    const lane = new BoundedStreamLane();
    expect(lane.enqueue(frame("a", 1))).toEqual({ replayed: false });
    expect(lane.enqueue(frame("a", 1))).toEqual({ replayed: true });
    expect(() => lane.enqueue(frame("a", 3))).toThrow(
      "STREAM_FRAME_OUT_OF_ORDER",
    );
    lane.acknowledge("a", 1);
    expect(lane.snapshot("a")?.bufferedBytes).toBe(0);
  });

  test("drains streams fairly and contains a slow consumer", () => {
    const lane = new BoundedStreamLane({ maxStreamBufferBytes: 250 });
    lane.enqueue(frame("a", 1));
    lane.enqueue(frame("b", 1));
    expect(lane.drainNext()?.streamId).toBe("a");
    expect(lane.drainNext()?.streamId).toBe("b");
    expect(() => lane.enqueue(frame("a", 2, "x".repeat(200)))).toThrow(
      "STREAM_BACKPRESSURE_LIMIT_EXCEEDED",
    );
    expect(lane.snapshot("a")?.cancelled).toBe(true);
    expect(lane.snapshot("b")?.cancelled).toBe(false);
  });

  test("bounds the aggregate queue across many streams", () => {
    const encodedBytes = new TextEncoder().encode(
      JSON.stringify(frame("a", 1)),
    ).byteLength;
    const lane = new BoundedStreamLane({
      maxStreamBufferBytes: encodedBytes * 4,
      maxTotalBufferBytes: encodedBytes * 2 + 8,
    });
    lane.enqueue(frame("a", 1));
    lane.enqueue(frame("b", 1));
    expect(() => lane.enqueue(frame("c", 1))).toThrow(
      "STREAM_GLOBAL_BACKPRESSURE_LIMIT_EXCEEDED",
    );
    expect(lane.snapshot("c")?.cancelled).toBe(true);
    expect(lane.totalBufferedBytes()).toBeGreaterThan(0);
    lane.acknowledge("a", 1);
    lane.acknowledge("b", 1);
    expect(lane.totalBufferedBytes()).toBe(0);
  });
});
