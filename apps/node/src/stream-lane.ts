import {
  MAX_NODE_STREAM_BUFFER_BYTES,
  MAX_NODE_STREAM_FRAME_BYTES,
  nodeStreamFrameSchema,
  type NodeStreamFrame,
} from "@avermate/agent-contracts";
import { canonicalDigest } from "./canonical-json";

type StreamState = {
  lastSequence: number;
  acknowledged: number;
  bufferedBytes: number;
  cancelled: boolean;
  frames: Array<{ frame: NodeStreamFrame; bytes: number; digest: string }>;
};

/** Per-stream flow control; control frames never enter this queue. */
export class BoundedStreamLane {
  readonly #maxFrameBytes: number;
  readonly #maxStreamBufferBytes: number;
  readonly #maxTotalBufferBytes: number;
  readonly #streams = new Map<string, StreamState>();
  #roundRobinCursor = 0;
  #totalBufferedBytes = 0;

  constructor(
    input: {
      maxFrameBytes?: number;
      maxStreamBufferBytes?: number;
      maxTotalBufferBytes?: number;
    } = {},
  ) {
    this.#maxFrameBytes = input.maxFrameBytes ?? MAX_NODE_STREAM_FRAME_BYTES;
    this.#maxStreamBufferBytes =
      input.maxStreamBufferBytes ?? MAX_NODE_STREAM_BUFFER_BYTES;
    this.#maxTotalBufferBytes =
      input.maxTotalBufferBytes ?? MAX_NODE_STREAM_BUFFER_BYTES;
  }

  enqueue(input: NodeStreamFrame) {
    const frame = nodeStreamFrameSchema.parse(input);
    const bytes = new TextEncoder().encode(JSON.stringify(frame)).byteLength;
    if (bytes > this.#maxFrameBytes)
      throw new Error("STREAM_FRAME_LIMIT_EXCEEDED");
    const state = this.#streams.get(frame.streamId) ?? {
      lastSequence: 0,
      acknowledged: 0,
      bufferedBytes: 0,
      cancelled: false,
      frames: [],
    };
    if (state.cancelled) throw new Error("STREAM_CANCELLED");
    const digest = canonicalDigest(frame);
    const duplicate = state.frames.find(
      (entry) => entry.frame.sequence === frame.sequence,
    );
    if (duplicate) {
      if (duplicate.digest !== digest)
        throw new Error("STREAM_FRAME_REPLAY_MISMATCH");
      return { replayed: true };
    }
    if (frame.sequence !== state.lastSequence + 1)
      throw new Error("STREAM_FRAME_OUT_OF_ORDER");
    if (state.bufferedBytes + bytes > this.#maxStreamBufferBytes) {
      state.cancelled = true;
      this.#totalBufferedBytes -= state.bufferedBytes;
      state.frames = [];
      state.bufferedBytes = 0;
      this.#streams.set(frame.streamId, state);
      throw new Error("STREAM_BACKPRESSURE_LIMIT_EXCEEDED");
    }
    if (this.#totalBufferedBytes + bytes > this.#maxTotalBufferBytes) {
      state.cancelled = true;
      this.#totalBufferedBytes -= state.bufferedBytes;
      state.frames = [];
      state.bufferedBytes = 0;
      this.#streams.set(frame.streamId, state);
      throw new Error("STREAM_GLOBAL_BACKPRESSURE_LIMIT_EXCEEDED");
    }
    state.lastSequence = frame.sequence;
    state.frames.push({ frame, bytes, digest });
    state.bufferedBytes += bytes;
    this.#totalBufferedBytes += bytes;
    this.#streams.set(frame.streamId, state);
    return { replayed: false };
  }

  acknowledge(streamId: string, sequence: number) {
    const state = this.#streams.get(streamId);
    if (!state) return;
    if (sequence < state.acknowledged || sequence > state.lastSequence) {
      throw new Error("STREAM_ACK_OUT_OF_RANGE");
    }
    state.acknowledged = sequence;
    const retained = state.frames.filter(
      (entry) => entry.frame.sequence > sequence,
    );
    const previousBytes = state.bufferedBytes;
    state.bufferedBytes = retained.reduce(
      (total, entry) => total + entry.bytes,
      0,
    );
    this.#totalBufferedBytes -= previousBytes - state.bufferedBytes;
    state.frames = retained;
  }

  cancel(streamId: string) {
    const state = this.#streams.get(streamId);
    if (!state) return;
    state.cancelled = true;
    this.#totalBufferedBytes -= state.bufferedBytes;
    state.frames = [];
    state.bufferedBytes = 0;
  }

  drainNext(): NodeStreamFrame | null {
    const active = [...this.#streams.entries()].filter(
      ([, state]) => state.frames.length > 0,
    );
    if (active.length === 0) return null;
    this.#roundRobinCursor %= active.length;
    const [, state] = active[this.#roundRobinCursor];
    this.#roundRobinCursor = (this.#roundRobinCursor + 1) % active.length;
    return state.frames[0]?.frame ?? null;
  }

  snapshot(streamId: string) {
    const state = this.#streams.get(streamId);
    return state ? structuredClone(state) : null;
  }

  totalBufferedBytes() {
    return this.#totalBufferedBytes;
  }
}
