import { Hono } from "hono";
import {
  nodeCredentialDeliveryProofSchema,
  nodePairingRegistrationSchema,
} from "@avermate/agent-contracts";
import { coreNodeRegistry } from "./services";

const MAX_PAIRING_BODY_BYTES = 384 * 1024;

async function boundedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_PAIRING_BODY_BYTES) {
    throw new Error("NODE_PAIRING_BODY_TOO_LARGE");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_PAIRING_BODY_BYTES) {
    throw new Error("NODE_PAIRING_BODY_TOO_LARGE");
  }
  return JSON.parse(body) as unknown;
}

function safeError(error: unknown) {
  const candidate = error instanceof Error ? error.message : "NODE_PAIRING_FAILED";
  return /^[A-Z0-9_:-]{3,128}$/u.test(candidate)
    ? candidate
    : "NODE_PAIRING_FAILED";
}

async function response(operation: () => Promise<unknown>) {
  try {
    return Response.json(await operation(), {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: safeError(error) },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}

/** Node-signed bootstrap lane. No browser session or reusable credential. */
export const nodePairingRoutes = new Hono();

nodePairingRoutes.post("/node/pairing/register", (context) =>
  response(async () =>
    coreNodeRegistry.registerPairing(
      nodePairingRegistrationSchema.parse(await boundedJson(context.req.raw)),
    ),
  ),
);

nodePairingRoutes.post("/node/pairing/credentials", (context) =>
  response(async () =>
    coreNodeRegistry.deliverCredentials(
      nodeCredentialDeliveryProofSchema.parse(
        await boundedJson(context.req.raw),
      ),
    ),
  ),
);

nodePairingRoutes.post("/node/pairing/credentials/ack", (context) =>
  response(async () =>
    coreNodeRegistry.acknowledgeCredentials(
      nodeCredentialDeliveryProofSchema.parse(
        await boundedJson(context.req.raw),
      ),
    ),
  ),
);
