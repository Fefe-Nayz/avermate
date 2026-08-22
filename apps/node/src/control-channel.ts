import {
  MAX_NODE_CONTROL_FRAME_BYTES,
  MAX_NODE_CONTROL_BUFFER_BYTES,
  nodeControlFrameSchema,
  type NodeCapabilityManifestV2,
  type NodeControlFrame,
} from "@avermate/agent-contracts";

export type OutboundControlConnection = {
  incoming: AsyncIterable<string | Uint8Array>;
  send(payload: string): Promise<void>;
  close(): Promise<void>;
};

export interface OutboundControlConnector {
  connect(input: {
    url: URL;
    credential: string;
    signal: AbortSignal;
  }): Promise<OutboundControlConnection>;
}

export type NodeControlHandlers = {
  onJobOffer?(
    frame: Extract<NodeControlFrame, { type: "job-offer" }>,
  ): Promise<void>;
  onJobCancel?(
    frame: Extract<NodeControlFrame, { type: "job-cancel" }>,
  ): Promise<void>;
  onJobAck?(
    frame: Extract<NodeControlFrame, { type: "job-ack" }>,
  ): Promise<void>;
  onShutdown?(
    frame: Extract<NodeControlFrame, { type: "shutdown" }>,
  ): Promise<void>;
};

function byteLength(value: string | Uint8Array) {
  return typeof value === "string"
    ? new TextEncoder().encode(value).byteLength
    : value.byteLength;
}

export function encodeControlFrame(frame: NodeControlFrame) {
  const parsed = nodeControlFrameSchema.parse(frame);
  const encoded = JSON.stringify(parsed);
  if (byteLength(encoded) > MAX_NODE_CONTROL_FRAME_BYTES) {
    throw new Error("NODE_CONTROL_FRAME_TOO_LARGE");
  }
  return encoded;
}

export function decodeControlFrame(value: string | Uint8Array) {
  if (byteLength(value) > MAX_NODE_CONTROL_FRAME_BYTES) {
    throw new Error("NODE_CONTROL_FRAME_TOO_LARGE");
  }
  const text =
    typeof value === "string" ? value : new TextDecoder().decode(value);
  return nodeControlFrameSchema.parse(JSON.parse(text));
}

export class OutboundNodeControlChannel {
  readonly #connector: OutboundControlConnector;
  readonly #url: URL;
  readonly #credential: string;
  readonly #manifest: () => Promise<NodeCapabilityManifestV2>;
  readonly #handlers: NodeControlHandlers;
  readonly #backoff: (attempt: number, signal: AbortSignal) => Promise<void>;

  constructor(input: {
    connector: OutboundControlConnector;
    url: URL;
    credential: string;
    manifest: () => Promise<NodeCapabilityManifestV2>;
    handlers?: NodeControlHandlers;
    backoff?: (attempt: number, signal: AbortSignal) => Promise<void>;
  }) {
    if (!input.credential || input.credential.length < 32) {
      throw new Error("NODE_CHANNEL_CREDENTIAL_INVALID");
    }
    if (input.url.protocol !== "wss:")
      throw new Error("NODE_CHANNEL_TLS_REQUIRED");
    this.#connector = input.connector;
    this.#url = input.url;
    this.#credential = input.credential;
    this.#manifest = input.manifest;
    this.#handlers = input.handlers ?? {};
    this.#backoff =
      input.backoff ??
      ((attempt, signal) =>
        new Promise<void>((resolve) => {
          const timeout = setTimeout(
            resolve,
            Math.min(30_000, 250 * 2 ** attempt),
          );
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        }));
  }

  async runOnce(signal: AbortSignal) {
    const connection = await this.#connector.connect({
      url: this.#url,
      credential: this.#credential,
      signal,
    });
    try {
      await connection.send(
        encodeControlFrame({
          type: "hello",
          frameId: `frame_${crypto.randomUUID()}`,
          manifest: await this.#manifest(),
        }),
      );
      for await (const payload of connection.incoming) {
        if (signal.aborted) break;
        const frame = decodeControlFrame(payload);
        switch (frame.type) {
          case "job-offer":
            await this.#handlers.onJobOffer?.(frame);
            break;
          case "job-cancel":
            await this.#handlers.onJobCancel?.(frame);
            break;
          case "job-ack":
            await this.#handlers.onJobAck?.(frame);
            break;
          case "shutdown":
            await this.#handlers.onShutdown?.(frame);
            return;
          case "hello":
          case "health":
            throw new Error("NODE_CONTROL_DIRECTION_INVALID");
        }
      }
    } finally {
      await connection.close();
    }
  }

  async run(signal: AbortSignal) {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        await this.runOnce(signal);
        attempt = 0;
      } catch (error) {
        if (signal.aborted) return;
        attempt += 1;
        await this.#backoff(attempt, signal);
        if (signal.aborted) return;
        if (attempt >= 100) throw error;
      }
    }
  }
}

class AsyncMessageQueue implements AsyncIterable<string | Uint8Array> {
  readonly #values: Array<string | Uint8Array> = [];
  readonly #waiters: Array<{
    resolve: (result: IteratorResult<string | Uint8Array>) => void;
    reject: (error: Error) => void;
  }> = [];
  #bufferedBytes = 0;
  #closed = false;
  #error: Error | null = null;

  push(value: string | Uint8Array) {
    if (this.#closed) return false;
    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve({ done: false, value });
    else {
      const nextBytes = this.#bufferedBytes + byteLength(value);
      if (
        this.#values.length >= 64 ||
        nextBytes > MAX_NODE_CONTROL_BUFFER_BYTES
      ) {
        this.fail(new Error("NODE_CONTROL_BUFFER_OVERFLOW"));
        return false;
      }
      this.#values.push(value);
      this.#bufferedBytes = nextBytes;
    }
    return true;
  }

  close() {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  fail(error: Error) {
    this.#error = error;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }

  [Symbol.asyncIterator]() {
    return {
      next: (): Promise<IteratorResult<string | Uint8Array>> => {
        const value = this.#values.shift();
        if (value !== undefined) {
          this.#bufferedBytes -= byteLength(value);
          return Promise.resolve({ done: false, value });
        }
        if (this.#error) return Promise.reject(this.#error);
        if (this.#closed)
          return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve, reject) =>
          this.#waiters.push({ resolve, reject }),
        );
      },
    };
  }
}

/** Real outbound WSS connector. The rotating credential is an HTTP header only. */
export class BunWebSocketControlConnector implements OutboundControlConnector {
  async connect(input: {
    url: URL;
    credential: string;
    signal: AbortSignal;
  }): Promise<OutboundControlConnection> {
    if (input.url.protocol !== "wss:")
      throw new Error("NODE_CHANNEL_TLS_REQUIRED");
    const queue = new AsyncMessageQueue();
    const WebSocketWithHeaders = WebSocket as unknown as {
      new (
        url: string | URL,
        options: { headers: Record<string, string> },
      ): WebSocket;
    };
    const socket = new WebSocketWithHeaders(input.url, {
      headers: { Authorization: `Bearer ${input.credential}` },
    });
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        socket.close(1000, "aborted");
        reject(new Error("NODE_CHANNEL_ABORTED"));
      };
      input.signal.addEventListener("abort", abort, { once: true });
      socket.addEventListener(
        "open",
        () => {
          input.signal.removeEventListener("abort", abort);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          input.signal.removeEventListener("abort", abort);
          reject(new Error("NODE_CHANNEL_CONNECT_FAILED"));
        },
        { once: true },
      );
    });
    const abort = () => socket.close(1000, "aborted");
    input.signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        if (!queue.push(event.data))
          socket.close(1009, "control buffer overflow");
      } else if (event.data instanceof ArrayBuffer) {
        if (!queue.push(new Uint8Array(event.data))) {
          socket.close(1009, "control buffer overflow");
        }
      } else socket.close(1003, "unsupported frame");
    });
    socket.addEventListener("close", () => {
      input.signal.removeEventListener("abort", abort);
      queue.close();
    });
    socket.addEventListener("error", () => queue.close());
    return {
      incoming: queue,
      send: async (payload) => {
        if (socket.readyState !== WebSocket.OPEN) {
          throw new Error("NODE_CHANNEL_OFFLINE");
        }
        socket.send(payload);
      },
      close: async () => {
        input.signal.removeEventListener("abort", abort);
        if (socket.readyState < WebSocket.CLOSING) socket.close(1000, "closed");
        queue.close();
      },
    };
  }
}

export function controlChannelUrl(coreUrl: string) {
  const url = new URL(coreUrl);
  if (url.protocol !== "https:") throw new Error("NODE_RELAY_TLS_REQUIRED");
  url.protocol = "wss:";
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/api/node/control`;
  url.search = "";
  url.hash = "";
  return url;
}
