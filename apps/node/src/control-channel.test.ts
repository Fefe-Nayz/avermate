import { describe, expect, test } from "bun:test";
import type {
  NodeCapabilityManifestV2,
  NodeControlFrame,
} from "@avermate/agent-contracts";
import {
  controlChannelUrl,
  decodeControlFrame,
  encodeControlFrame,
  OutboundNodeControlChannel,
  type OutboundControlConnection,
  type OutboundControlConnector,
} from "./control-channel";

async function* messages(frames: NodeControlFrame[]) {
  for (const frame of frames) yield encodeControlFrame(frame);
}

class MockConnector implements OutboundControlConnector {
  readonly connections: Array<{ incoming: NodeControlFrame[]; sent: string[] }>;
  calls = 0;

  constructor(connections: NodeControlFrame[][]) {
    this.connections = connections.map((incoming) => ({ incoming, sent: [] }));
  }

  async connect(input: {
    credential: string;
  }): Promise<OutboundControlConnection> {
    expect(input.credential).toBe("c".repeat(48));
    const connection = this.connections[this.calls++];
    if (!connection) throw new Error("NO_MOCK_CONNECTION");
    return {
      incoming: messages(connection.incoming),
      send: async (payload) => {
        connection.sent.push(payload);
      },
      close: async () => undefined,
    };
  }
}

function manifest(revision: `sha256:${string}`): NodeCapabilityManifestV2 {
  return {
    protocol: "avermate-node/2",
    nodeId: "node-1",
    build: "test",
    configRevision: revision,
    features: {},
    limits: {
      maxConcurrentJobs: 1,
      maxControlFrameBytes: 256 * 1024,
      maxStreamFrameBytes: 64 * 1024,
      maxBufferedStreamBytes: 2 * 1024 * 1024,
      storageQuotaBytes: 1,
      storageUsedBytes: 0,
    },
    issuedAt: new Date(0).toISOString(),
    expiresAt: new Date(60_000).toISOString(),
    keyId: "key-1",
    signature: "A".repeat(64),
  };
}

describe("outbound control channel", () => {
  test("sends a fresh manifest on every reconnect and handles ack/cancel", async () => {
    const connector = new MockConnector([
      [
        {
          type: "job-cancel",
          frameId: "cancel-1",
          nodeId: "node-1",
          jobId: "job-1",
          reason: "user request",
        },
      ],
      [
        {
          type: "job-ack",
          frameId: "ack-1",
          nodeId: "node-1",
          jobId: "job-1",
          sequence: 4,
        },
        {
          type: "shutdown",
          frameId: "shutdown-1",
          nodeId: "node-1",
          reason: "test complete",
        },
      ],
    ]);
    let revision = 0;
    const handled: string[] = [];
    const channel = new OutboundNodeControlChannel({
      connector,
      url: new URL("wss://core.invalid/api/node/control"),
      credential: "c".repeat(48),
      manifest: async () =>
        manifest(`sha256:${String(++revision).padStart(64, "0")}`),
      handlers: {
        onJobCancel: async () => {
          handled.push("cancel");
        },
        onJobAck: async () => {
          handled.push("ack");
        },
      },
    });
    const signal = new AbortController().signal;
    await channel.runOnce(signal);
    await channel.runOnce(signal);
    expect(handled).toEqual(["cancel", "ack"]);
    const first = decodeControlFrame(connector.connections[0].sent[0]);
    const second = decodeControlFrame(connector.connections[1].sent[0]);
    expect(first.type).toBe("hello");
    expect(second.type).toBe("hello");
    if (first.type === "hello" && second.type === "hello") {
      expect(first.manifest.configRevision).not.toBe(
        second.manifest.configRevision,
      );
    }
  });

  test("rejects non-TLS relay URLs and oversized control frames", () => {
    expect(
      () =>
        new OutboundNodeControlChannel({
          connector: new MockConnector([]),
          url: new URL("ws://localhost/control"),
          credential: "c".repeat(48),
          manifest: async () => manifest(`sha256:${"0".repeat(64)}`),
        }),
    ).toThrow("NODE_CHANNEL_TLS_REQUIRED");
    expect(() => decodeControlFrame("x".repeat(256 * 1024 + 1))).toThrow(
      "NODE_CONTROL_FRAME_TOO_LARGE",
    );
  });

  test("permits only the exact authenticated single-host Compose relay", () => {
    expect(
      controlChannelUrl("http://api:5000", "local-compose").toString(),
    ).toBe("ws://api:5000/api/node/control");
    expect(
      controlChannelUrl("http://api:5000/", "local-compose").toString(),
    ).toBe("ws://api:5000/api/node/control");
    expect(() =>
      controlChannelUrl("http://localhost:5000", "local-compose"),
    ).toThrow("NODE_RELAY_LOCAL_COMPOSE_TARGET_INVALID");
    expect(() =>
      controlChannelUrl("http://api:5001", "local-compose"),
    ).toThrow("NODE_RELAY_LOCAL_COMPOSE_TARGET_INVALID");

    expect(
      () =>
        new OutboundNodeControlChannel({
          connector: new MockConnector([]),
          url: new URL("ws://api:5000/api/node/control"),
          credential: "c".repeat(48),
          manifest: async () => manifest(`sha256:${"0".repeat(64)}`),
        }),
    ).not.toThrow();
    expect(
      () =>
        new OutboundNodeControlChannel({
          connector: new MockConnector([]),
          url: new URL("ws://api:5000/api/node/other"),
          credential: "c".repeat(48),
          manifest: async () => manifest(`sha256:${"0".repeat(64)}`),
        }),
    ).toThrow("NODE_CHANNEL_TLS_REQUIRED");
  });
});
