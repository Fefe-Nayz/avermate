import { afterEach, describe, expect, test } from "bun:test"
import type {
  NodeCapabilityGrantClaims,
  NodeControlFrame,
} from "@avermate/agent-contracts"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeCapabilityOperationDispatcher } from "./capability-dispatcher"
import { canonicalDigest } from "./canonical-json"
import { loadOrCreateNodeIdentity } from "./identity"
import type { LocalNodeMcpTransport } from "./mcp-transport"
import { NodeOperationResultLedger } from "./operation-ledger"
import { LocalNodeProviderTransport } from "./provider-transport"
import { GrantReplayLedger, signCapabilityGrant } from "./protocol"

let directory = ""

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = ""
})

async function harness(input: {
  invoke(request: unknown, signal?: AbortSignal): Promise<unknown>
}) {
  directory = await mkdtemp(join(tmpdir(), "avermate-node-mcp-dispatch-"))
  const core = await loadOrCreateNodeIdentity(join(directory, "core.json"))
  const nodeId = "node-mcp-owner-a"
  const ownerId = "owner-a"
  const configRevision = `sha256:${"d".repeat(64)}`
  let invocationCount = 0
  const mcp = {
    async inspect() {
      return { tools: [] }
    },
    async invoke(request: { request: unknown; signal?: AbortSignal }) {
      invocationCount += 1
      return input.invoke(request.request, request.signal)
    },
  } as unknown as LocalNodeMcpTransport
  const transport = new LocalNodeProviderTransport(nodeId, { mcp })
  const published: Array<
    Extract<NodeControlFrame, { type: "operation-result" }>
  > = []
  let terminal!: () => void
  let completed = new Promise<void>((resolve) => (terminal = resolve))
  const dispatcher = new NodeCapabilityOperationDispatcher({
    nodeId,
    corePublicKeyDer: core.publicKeyDer,
    coreKeyId: core.keyId,
    configRevision: () => configRevision,
    transport,
    grantReplay: new GrantReplayLedger(join(directory, "grants.json")),
    results: new NodeOperationResultLedger({
      path: join(directory, "results.json"),
      maximumBytes: 1024 * 1024,
    }),
    maximumConcurrent: 2,
    publish: async (frame) => {
      published.push(frame)
      if (frame.terminal) terminal()
    },
  })
  await dispatcher.initialize()
  function frame(options: {
    operationId: string
    ownerId?: string
    capability?: "mcp" | "retrieval"
    byteLimit?: number
  }) {
    const operation = "mcp.invoke" as const
    const effectiveOwner = options.ownerId ?? ownerId
    const payload = {
      ownerId: effectiveOwner,
      input: {
        connection: {
          endpointUrl: "http://mcp.internal/mcp",
          authKind: "bearer",
          credential: "private-dispatch-credential",
        },
        remoteToolId: "library.search",
        arguments: { query: "fractions" },
      },
    }
    const deadline = new Date(Date.now() + 60_000).toISOString()
    const capability = options.capability ?? "mcp"
    const requestDigest = canonicalDigest({
      nodeId,
      userId: effectiveOwner,
      capability,
      capabilityVersion: 1,
      operationId: options.operationId,
      operation,
      payload,
      configRevision,
      deadline,
    })
    const claims: NodeCapabilityGrantClaims = {
      version: 1,
      issuer: "core",
      audience: nodeId,
      subject: effectiveOwner,
      nodeId,
      userId: effectiveOwner,
      actorKind: "mcp",
      jobId: options.operationId,
      jti: `grant-${options.operationId}`,
      operation,
      requestDigest,
      configRevision,
      capabilities: [`node:${capability}:${operation}`],
      resources: [],
      limits: {
        byteLimit: options.byteLimit ?? 128 * 1024,
        tokenLimit: 0,
        costMinorLimit: 0,
        deadline,
      },
      notBefore: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: deadline,
      issuedAt: new Date().toISOString(),
    }
    return {
      type: "operation-request" as const,
      frameId: `frame-${options.operationId}`,
      nodeId,
      connectionEpoch: 1,
      operationId: options.operationId,
      capability,
      capabilityVersion: 1,
      operation,
      configRevision,
      deadline,
      grant: signCapabilityGrant(core, claims),
      payload,
    }
  }
  return {
    dispatcher,
    frame,
    published,
    wait: () => completed,
    replayWait() {
      completed = new Promise<void>((resolve) => (terminal = resolve))
      return completed
    },
    invocationCount: () => invocationCount,
  }
}

describe("signed Node MCP capability operations", () => {
  test("executes once, journals a bounded result, and replays deterministically", async () => {
    const state = await harness({
      async invoke() {
        return { isError: false, text: "result:fractions" }
      },
    })
    const operation = state.frame({ operationId: "mcp-replay" })
    expect(await state.dispatcher.accept(operation)).toEqual({
      accepted: true,
      replayed: false,
    })
    await state.wait()
    expect(state.invocationCount()).toBe(1)
    expect(JSON.stringify(state.published)).not.toContain(
      "private-dispatch-credential"
    )
    state.published.splice(0)
    const replayed = state.replayWait()
    expect(await state.dispatcher.accept(operation)).toEqual({
      accepted: true,
      replayed: true,
    })
    await replayed
    expect(state.invocationCount()).toBe(1)
    expect(state.published[0]?.payload).toEqual({
      isError: false,
      text: "result:fractions",
    })
  })

  test("rejects a wrong capability binding before reaching the MCP transport", async () => {
    const state = await harness({ async invoke() { return { isError: false, text: "no" } } })
    await expect(
      state.dispatcher.accept(
        state.frame({ operationId: "mcp-wrong-capability", capability: "retrieval" })
      )
    ).rejects.toThrow("NODE_OPERATION_CAPABILITY_MISMATCH")
    expect(state.invocationCount()).toBe(0)
  })

  test("cancels an in-flight MCP operation through the relay operation ID", async () => {
    const state = await harness({
      async invoke(_request, signal) {
        return new Promise((resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("NODE_OPERATION_CANCELLED")),
            { once: true }
          )
        })
      },
    })
    const operation = state.frame({ operationId: "mcp-cancel" })
    await state.dispatcher.accept(operation)
    expect(await state.dispatcher.cancel("mcp-cancel")).toBe(true)
    await state.wait()
    expect(state.published.at(-1)).toMatchObject({
      ok: false,
      terminal: true,
      safeErrorCode: "NODE_OPERATION_CANCELLED",
    })
  })

  test("fails closed when a result exceeds the signed byte budget", async () => {
    const state = await harness({
      async invoke() {
        return { isError: false, text: "x".repeat(10_000) }
      },
    })
    await state.dispatcher.accept(
      state.frame({ operationId: "mcp-budget", byteLimit: 512 })
    )
    await state.wait()
    expect(state.published.at(-1)).toMatchObject({
      ok: false,
      terminal: true,
      safeErrorCode: "GRANT_BYTE_LIMIT_EXCEEDED",
    })
  })
})
