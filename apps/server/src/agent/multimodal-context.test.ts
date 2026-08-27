import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  contextAssetHandleSchema,
  type ModelDescriptor,
  type ModelRequest,
} from "@avermate/agent-contracts";
import sharp from "sharp";
import {
  ContextAssetHandleService,
  ContextMediaError,
  OwnedFileContextAssetResolver,
  prepareModelPrompt,
  type ContextAssetResolver,
  type ContextMediaErrorCode,
} from "./multimodal-context";

const handle = contextAssetHandleSchema.parse(`cah1.${"a".repeat(32)}`);
const onePixelPng = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
const imageDigest = createHash("sha256").update(onePixelPng).digest("hex");

function singlePagePdf() {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << >> /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "ascii"));
}

const textModel: ModelDescriptor = {
  id: "text-model",
  provider: "fixture",
  displayName: "Text model",
  modalities: ["text"],
  capabilities: {
    tools: true,
    reasoningSummary: false,
    cachedUsage: false,
    structuredOutput: false,
  },
  contextWindow: 8_192,
};

const imageModel: ModelDescriptor = {
  ...textModel,
  id: "image-model",
  displayName: "Image model",
  modalities: ["text", "image"],
};

function imageRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    ownerId: "owner-1",
    runId: "run-1",
    modelId: imageModel.id,
    tools: [],
    messages: [
      {
        id: "diagram",
        trust: "retrieved-untrusted",
        mediaType: "multipart/mixed",
        content: "Diagram OCR",
        sourceRef: "material-1",
        redactions: [],
        parts: [
          {
            type: "image",
            assetHandle: handle,
            mime: "image/png",
            fallbackText: "Triangle rectangle avec côtés a, b et c.",
            evidence: {
              chunkId: "chunk-3",
              locator: { kind: "pdf", page: 3 },
              digest: imageDigest,
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function resolver(
  override: Partial<Awaited<ReturnType<ContextAssetResolver["resolve"]>>> = {},
): ContextAssetResolver {
  return {
    async resolve() {
      return {
        ownerId: "owner-1",
        assetId: "file-1",
        mime: "image/png",
        byteSize: onePixelPng.byteLength,
        bytes: onePixelPng,
        ...override,
      };
    },
  };
}

describe("server-owned multimodal context", () => {
  test("resolves an image only for a compatible model and retains citation proof", async () => {
    const prepared = await prepareModelPrompt({
      request: imageRequest(),
      descriptor: imageModel,
      assetResolver: resolver(),
    });

    expect(prepared.mediaUsage).toEqual({ parts: 1, bytes: 68, pixels: 1 });
    expect(prepared.fallbacks).toEqual([]);
    expect(prepared.citations).toEqual([
      {
        blockId: "diagram",
        partIndex: 0,
        sourceRef: "material-1",
        chunkId: "chunk-3",
        page: 3,
        locator: { kind: "pdf", page: 3 },
        digest: imageDigest,
        delivery: "media",
      },
    ]);
    const serialized = JSON.stringify(prepared.messages);
    expect(serialized).not.toContain(handle);
    expect(serialized).not.toContain("assetHandle");
  });

  test("uses the explicit OCR/text fallback without resolving for a text model", async () => {
    let resolved = false;
    const prepared = await prepareModelPrompt({
      request: imageRequest({ modelId: textModel.id }),
      descriptor: textModel,
      assetResolver: {
        async resolve() {
          resolved = true;
          throw new Error("must not run");
        },
      },
    });

    expect(resolved).toBe(false);
    expect(JSON.stringify(prepared.messages)).toContain(
      "Triangle rectangle avec côtés a, b et c.",
    );
    expect(prepared.fallbacks).toEqual([
      {
        blockId: "diagram",
        partIndex: 0,
        mediaType: "image",
        reason: "model-image-unsupported",
      },
    ]);
    expect(prepared.citations[0]).toMatchObject({
      chunkId: "chunk-3",
      page: 3,
      digest: imageDigest,
      delivery: "text-fallback",
    });
  });

  test("delivers an immutable one-page PDF only to file-capable models", async () => {
    const bytes = singlePagePdf();
    const expectedDigest = createHash("sha256").update(bytes).digest("hex");
    const descriptor: ModelDescriptor = {
      ...textModel,
      id: "file-model",
      modalities: ["text", "file"],
    };
    const request = imageRequest({ modelId: descriptor.id });
    request.messages = [
      {
        ...request.messages[0]!,
        id: "pdf-page",
        parts: [
          {
            type: "pdf-page",
            assetHandle: handle,
            mime: "application/pdf",
            fallbackText: "Texte natif de la page 4.",
            evidence: {
              chunkId: "chunk-4",
              locator: { kind: "pdf", page: 4 },
              digest: expectedDigest,
            },
          },
        ],
      },
    ];
    const prepared = await prepareModelPrompt({
      request,
      descriptor,
      assetResolver: resolver({
        mime: "application/pdf",
        byteSize: bytes.byteLength,
        bytes,
      }),
    });

    expect(prepared.mediaUsage).toMatchObject({ parts: 1, bytes: bytes.length });
    expect(prepared.citations[0]).toMatchObject({
      chunkId: "chunk-4",
      page: 4,
      digest: expectedDigest,
      delivery: "media",
    });
    expect(JSON.stringify(prepared.messages)).not.toContain(handle);
  });

  test("fails closed on cross-owner, digest, MIME and resolver failures", async () => {
    const invalidPng = new Uint8Array(onePixelPng.byteLength).fill(7);
    const invalidMagicRequest = imageRequest();
    const invalidMagicPart = invalidMagicRequest.messages[0]?.parts?.[0];
    if (!invalidMagicPart || invalidMagicPart.type !== "image") {
      throw new Error("bad fixture");
    }
    invalidMagicPart.evidence.digest = createHash("sha256")
      .update(invalidPng)
      .digest("hex");
    const cases: Array<{
      request?: ModelRequest;
      resolver: ContextAssetResolver;
      code: ContextMediaErrorCode;
    }> = [
      {
        resolver: resolver({ ownerId: "owner-2" }),
        code: "CONTEXT_ASSET_OWNER_MISMATCH",
      },
      {
        resolver: resolver({ bytes: new Uint8Array(onePixelPng).fill(0) }),
        code: "CONTEXT_ASSET_DIGEST_MISMATCH",
      },
      {
        resolver: resolver({ mime: "image/jpeg" }),
        code: "CONTEXT_ASSET_METADATA_MISMATCH",
      },
      {
        request: invalidMagicRequest,
        resolver: resolver({ bytes: invalidPng }),
        code: "CONTEXT_ASSET_UNSAFE_BYTES",
      },
      {
        resolver: {
          async resolve() {
            throw new Error("private storage crash detail");
          },
        },
        code: "CONTEXT_ASSET_RESOLUTION_FAILED",
      },
    ];

    for (const fixture of cases) {
      try {
        await prepareModelPrompt({
          request: fixture.request ?? imageRequest(),
          descriptor: imageModel,
          assetResolver: fixture.resolver,
        });
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ContextMediaError);
        expect((error as ContextMediaError).code).toBe(fixture.code);
        expect(String(error)).not.toContain("private storage crash detail");
      }
    }
  });

  test("enforces media count, byte and decoded-pixel budgets", async () => {
    await expect(
      prepareModelPrompt({
        request: {
          ...imageRequest(),
          messages: Array.from({ length: 2 }, (_, index) => ({
            ...imageRequest().messages[0]!,
            id: `diagram-${index}`,
          })),
        },
        descriptor: imageModel,
        assetResolver: resolver(),
        mediaBudgets: { maximumParts: 1 },
      }),
    ).rejects.toMatchObject({ code: "CONTEXT_MEDIA_PART_LIMIT" });

    await expect(
      prepareModelPrompt({
        request: imageRequest(),
        descriptor: imageModel,
        assetResolver: resolver(),
        mediaBudgets: {
          maximumBytesPerPart: onePixelPng.byteLength - 1,
          maximumTotalBytes: onePixelPng.byteLength,
        },
      }),
    ).rejects.toMatchObject({ code: "CONTEXT_MEDIA_BYTE_LIMIT" });

    const twoPixelPng = new Uint8Array(
      await sharp({
        create: {
          width: 2,
          height: 1,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer(),
    );
    const request = imageRequest();
    const media = request.messages[0]?.parts?.[0];
    if (!media || media.type !== "image") throw new Error("bad fixture");
    media.evidence.digest = createHash("sha256")
      .update(twoPixelPng)
      .digest("hex");
    await expect(
      prepareModelPrompt({
        request,
        descriptor: imageModel,
        assetResolver: resolver({
          bytes: twoPixelPng,
          byteSize: twoPixelPng.byteLength,
        }),
        mediaBudgets: { maximumPixelsPerImage: 1 },
      }),
    ).rejects.toMatchObject({ code: "CONTEXT_MEDIA_PIXEL_LIMIT" });
  });

  test("opaque handles are owner-bound and owned file rows are re-authorized", async () => {
    const handles = new ContextAssetHandleService("s".repeat(32));
    const minted = await handles.mint({
      ownerId: "owner-1",
      assetId: "file-1",
    });
    await expect(
      handles.resolve({ ownerId: "owner-2", assetHandle: minted }),
    ).rejects.toMatchObject({ code: "CONTEXT_ASSET_OWNER_MISMATCH" });

    let read = false;
    const owned = new OwnedFileContextAssetResolver({
      handles,
      async loadOwnedFile() {
        return {
          id: "file-1",
          userId: "owner-2",
          provider: "local",
          storageKey: "private/foreign/file.png",
          mimeType: "image/png",
          byteSize: onePixelPng.byteLength,
          status: "stored",
        };
      },
      async readOwnedFile() {
        read = true;
        return onePixelPng.buffer;
      },
    });
    await expect(
      owned.resolve({
        ownerId: "owner-1",
        assetHandle: minted,
        maximumBytes: 1_024,
      }),
    ).rejects.toMatchObject({ code: "CONTEXT_ASSET_RESOLUTION_FAILED" });
    expect(read).toBe(false);
  });
});
