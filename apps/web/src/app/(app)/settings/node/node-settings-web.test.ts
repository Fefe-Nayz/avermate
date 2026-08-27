import { describe, expect, test } from "bun:test"

const read = (relative: string) =>
  Bun.file(new URL(relative, import.meta.url)).text()

describe("Avermate Node Web settings", () => {
  test("prefetches readiness, lifecycle and remote-deletion receipts", async () => {
    const page = await read("./page.tsx")
    expect(page).toContain("orpc.node.readiness.queryOptions")
    expect(page).toContain("orpc.node.list.queryOptions")
    expect(page).toContain("orpc.node.lifecycle.queryOptions")
    expect(page).toContain("orpc.node.remoteDeletions.queryOptions")
    expect(page).toContain("<HydrateClient")
  })

  test("requires an explicit fingerprint and capability confirmation", async () => {
    const source = await read("./node-settings-client.tsx")
    expect(source).toContain("orpc.node.claim.mutationOptions")
    expect(source).toContain("orpc.node.confirm.mutationOptions")
    expect(source).toContain("pairingPreview.fingerprint")
    expect(source).toContain("pairingPreview.capabilities")
    expect(source).toContain("node-identity-confirmation")
    expect(source).not.toContain("localStorage")
    expect(source).not.toContain("sessionStorage")
  })

  test("covers health, manifest, lifecycle and destructive credential controls", async () => {
    const source = await read("./node-settings-client.tsx")
    expect(source).toContain("node.manifestFresh")
    expect(source).toContain("node.configRevision")
    expect(source).toContain("node.health.map")
    expect(source).toContain("providerNativeRuntimeCheckpoints")
    expect(source).toContain("specialistKinds")
    expect(source).toContain("orpc.node.rotateCredentials.mutationOptions")
    expect(source).toContain("orpc.node.revoke.mutationOptions")
    expect(source).toContain("<RotateCredentialsDialog")
    expect(source).toContain("<RevokeNodeDialog")
    expect(source).toContain("orpc.node.remoteDeletions.queryOptions")
    expect(source).toContain("orpc.node.retryRemoteDeletion.mutationOptions")
    expect(source).toContain("Remote deletion receipts")
    expect(source).toContain('record.state === "verified_deleted"')
  })

  test("distinguishes provider configuration from a local vector index", async () => {
    const source = await read("./node-settings-client.tsx")
    expect(source).toContain("no local vector index is advertised.")
    expect(source).toContain("Embedding provider route: {provider} · {model}.")
    expect(source).toContain("Reranking provider route: {provider} · {model}.")
    expect(source).toContain(
      "Provider routes are configured capabilities; they do not imply a local vector index."
    )
    expect(source).not.toContain(
      "Retrieval: lexical {lexical}, {spaces} vector spaces."
    )
  })

  test("renders independent placements and the verified migration workflow", async () => {
    const source = await read("./node-settings-client.tsx")
    expect(source).toContain("NODE_CAPABILITIES.map")
    expect(source).toContain("orpc.node.setPlacement.mutationOptions")
    expect(source).toContain("no silent fallback")
    expect(source).toContain("Migration is planned, not completed")
    expect(source).toContain("Core ↔ Node migration")
    expect(source).toContain("orpc.node.startMigration.mutationOptions")
    expect(source).toContain("orpc.node.completeMigration.mutationOptions")
    expect(source).toContain('migration.resourceKind === "storage"')
    expect(source).toContain("fullSelfHostReadinessProgress")
    expect(source).toContain("Full-self-host onboarding")
    expect(source).toContain("data.expectedProtocolMajor")
  })

  test("ships route-level loading and error states", async () => {
    const [loading, error] = await Promise.all([
      read("./loading.tsx"),
      read("./error.tsx"),
    ])
    expect(loading).toContain("Loading Avermate Node settings")
    expect(error).toContain("Avermate Node settings could not be loaded")
    expect(error).toContain("reset")
  })
})
