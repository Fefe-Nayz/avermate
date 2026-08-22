import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import type { WSMessageReceive } from "hono/ws";
import { coreNodeRelay } from "./services";

function controlPayload(value: WSMessageReceive) {
  if (typeof value === "string") return value;
  if (value instanceof Blob) {
    throw new Error("NODE_CONTROL_BINARY_BLOB_UNSUPPORTED");
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value);
}

export const nodeControlRoutes = new Hono();

nodeControlRoutes.get("/node/control", async (context) => {
  if (context.req.header("upgrade")?.toLowerCase() !== "websocket") {
    return context.json({ error: "websocket_upgrade_required" }, 426);
  }
  let credential;
  try {
    credential = await coreNodeRelay.authenticate(
      context.req.header("authorization"),
    );
  } catch {
    return context.json(
      { error: "node_relay_credential_invalid" },
      401,
      { "cache-control": "no-store" },
    );
  }
  let connection: ReturnType<
    typeof coreNodeRelay.acceptAuthenticatedConnection
  > | null = null;
  return upgradeWebSocket(context, {
    onOpen: (_event, socket) => {
      connection = coreNodeRelay.acceptAuthenticatedConnection(credential, {
        send: (payload) => socket.send(payload),
        close: (code, reason) => socket.close(code, reason),
      });
    },
    onMessage: (event, socket) => {
      try {
        const payload = controlPayload(event.data);
        void connection?.receive(payload).catch(() => undefined);
      } catch {
        socket.close(1003, "unsupported control frame");
      }
    },
    onClose: () => {
      void connection?.close("PEER_CLOSED");
      connection = null;
    },
    onError: (_event, socket) => {
      void connection?.close("SOCKET_ERROR");
      socket.close(1011, "control channel error");
    },
  });
});
