import { describe, expect, test } from "bun:test";
import { adoptSandboxArtifacts, type ArtifactStagingUpload } from "./artifact-adoption";
import { MockSandboxProvider } from "./mock-provider";
import { enableSandboxProfile } from "./profiles";

const hostPolicyDigest = `sha256:${"f".repeat(64)}`;
const profile = enableSandboxProfile("latex", {
  version: "test-v1",
  imageDigest: `sha256:${"a".repeat(64)}`,
});
const now = new Date("2026-08-22T12:00:00.000Z");

describe("sandbox artifact adoption", () => {
  test("verifies content before returning an opaque object reference", async () => {
    const provider = new MockSandboxProvider({
      allowMock: true,
      hostPolicyDigest,
      profiles: [profile],
      now: () => now,
    });
    const handle = await provider.create({
      profile,
      expectedHostPolicyDigest: hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now,
      ownerId: "owner",
      threadId: "thread",
      branchId: "branch",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    for await (const _event of provider.execute({
      handle,
      executable: profile.entrypoints[0],
      argv: ["--avermate-conformance-v1"],
    })) {
      // consume deterministic fixture
    }
    const manifest = await provider.getFiles(handle, ["output/conformance.json"]);
    const objects = new Map<string, Uint8Array>();
    const adopted = await adoptSandboxArtifacts({
      provider,
      handle,
      manifest,
      policy: {
        maxFiles: 1,
        maxFileBytes: 1_024,
        maxTotalBytes: 1_024,
        allowedPathPrefixes: ["output/"],
        allowedKinds: ["json"],
      },
      store: {
        async begin(): Promise<ArtifactStagingUpload> {
          const chunks: Uint8Array[] = [];
          return {
            async write(chunk) {
              chunks.push(chunk.slice());
            },
            async commit() {
              const ref = `object:${objects.size + 1}`;
              objects.set(ref, Buffer.concat(chunks));
              return ref;
            },
            async abort() {
              chunks.length = 0;
            },
          };
        },
      },
      provenance: {
        ownerId: "owner",
        purpose: "generated-document",
        jobId: "job",
        toolCallId: "tool-call",
        profileVersion: profile.version,
        imageDigest: profile.image.imageDigest,
        inputRevision: "revision-1",
      },
    });
    expect(adopted).toHaveLength(1);
    expect(adopted[0].objectRef).toBe("object:1");
    expect(adopted[0]).not.toHaveProperty("sandboxPath");
  });

  test("rejects symlinks and path traversal before reading bytes", async () => {
    const provider = new MockSandboxProvider({
      allowMock: true,
      hostPolicyDigest,
      profiles: [profile],
      now: () => now,
    });
    const handle = await provider.create({
      profile,
      expectedHostPolicyDigest: hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now,
      ownerId: "owner",
      threadId: "thread",
      branchId: "branch",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(
      adoptSandboxArtifacts({
        provider,
        handle,
        manifest: [
          {
            relativePath: "../escape.pdf",
            digest: `sha256:${"0".repeat(64)}`,
            byteSize: 0,
            mimeType: "application/pdf",
            kind: "pdf",
            nodeType: "symlink",
          },
        ],
        policy: {
          maxFiles: 1,
          maxFileBytes: 1_024,
          maxTotalBytes: 1_024,
          allowedPathPrefixes: ["output/"],
          allowedKinds: ["pdf"],
        },
        store: { async begin() { throw new Error("must not stage"); } },
        provenance: {
          ownerId: "owner",
          purpose: "test",
          jobId: "job",
          toolCallId: "tool",
          profileVersion: profile.version,
          imageDigest: profile.image.imageDigest,
          inputRevision: "revision",
        },
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
  });

  test("rejects a PNG with a trailing polyglot payload", async () => {
    const provider = new MockSandboxProvider({
      allowMock: true,
      hostPolicyDigest,
      profiles: [profile],
      now: () => now,
    });
    const handle = await provider.create({
      profile,
      expectedHostPolicyDigest: hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now,
      ownerId: "owner",
      threadId: "thread",
      branchId: "polyglot",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
      ...new TextEncoder().encode("<script>polyglot</script>"),
    ]);
    const digest = `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`;
    provider.readFile = async function* () {
      yield bytes;
    };
    const manifest = [
      {
        relativePath: "output/polyglot.png",
        digest,
        byteSize: bytes.byteLength,
        mimeType: "image/png",
        kind: "png" as const,
        nodeType: "file" as const,
      },
    ];
    expect(
      adoptSandboxArtifacts({
        provider,
        handle,
        manifest,
        policy: {
          maxFiles: 1,
          maxFileBytes: 1_024,
          maxTotalBytes: 1_024,
          allowedPathPrefixes: ["output/"],
          allowedKinds: ["png"],
        },
        store: {
          async begin() {
            return {
              async write() {},
              async commit() { return "must-not-commit"; },
              async abort() {},
            };
          },
        },
        provenance: {
          ownerId: "owner",
          purpose: "test",
          jobId: "job",
          toolCallId: "tool",
          profileVersion: profile.version,
          imageDigest: profile.image.imageDigest,
          inputRevision: "revision",
        },
      }),
    ).rejects.toMatchObject({ code: "CONTENT_MISMATCH" });
  });
});
