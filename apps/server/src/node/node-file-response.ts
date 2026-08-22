import type { ObjectStorageProvider } from "@avermate/agent-contracts";
import {
  createPairedNodeObjectStorageProvider,
  nodeIdFromStorageProvider,
} from "./services";

export type NodeBackedFile = {
  provider: string;
  storageKey: string;
  userId: string;
  byteSize: number;
  mimeType: string;
};

function filename(storageKey: string) {
  return encodeURIComponent(
    (storageKey.split("/").at(-1) ?? "download")
      .replace(/[\r\n]/gu, "")
      .slice(0, 160),
  );
}

function rangeOf(value: string | null, byteSize: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!match) throw new Error("OBJECT_RANGE_INVALID");
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  let start: number;
  let endInclusive: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      throw new Error("OBJECT_RANGE_INVALID");
    }
    start = Math.max(0, byteSize - suffix);
    endInclusive = byteSize - 1;
  } else {
    start = Number(startText);
    endInclusive = endText ? Number(endText) : byteSize - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(endInclusive) ||
    start < 0 ||
    start >= byteSize ||
    endInclusive < start
  ) {
    throw new Error("OBJECT_RANGE_INVALID");
  }
  return { start, endInclusive: Math.min(endInclusive, byteSize - 1) };
}

function nodeUnavailable(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return (
    code.startsWith("NODE_") ||
    code === "OBJECT_NOT_FOUND" ||
    code === "OBJECT_READ_LIMIT_EXCEEDED"
  );
}

/**
 * Serve an authenticated Node-owned file without a Core byte fallback. The
 * resolver is injectable so the byte/range/offline contract stays testable
 * without a live relay.
 */
export async function nodeFileResponse(
  request: Request,
  file: NodeBackedFile,
  input: {
    disposition: "inline" | "attachment";
    cacheControl?: string;
    resolveProvider?: (input: {
      ownerId: string;
      nodeId: string;
    }) => Promise<ObjectStorageProvider>;
  },
) {
  const nodeId = nodeIdFromStorageProvider(file.provider);
  if (!nodeId) return null;
  const common = {
    "Content-Type": file.mimeType,
    "Content-Disposition": `${input.disposition}; filename*=UTF-8''${filename(file.storageKey)}`,
    "Cache-Control": input.cacheControl ?? "private, no-store",
    "Accept-Ranges": "bytes",
  };
  try {
    const provider = await (input.resolveProvider ??
      ((identity) => createPairedNodeObjectStorageProvider(identity)))({
      ownerId: file.userId,
      nodeId,
    });
    const ref = {
      ownerId: file.userId,
      namespace: "files" as const,
      key: file.storageKey,
    };
    const metadata = await provider.stat({ ref });
    if (!metadata) return new Response("File not found", { status: 404 });
    if (
      metadata.byteSize !== file.byteSize ||
      metadata.mimeType.toLowerCase() !== file.mimeType.toLowerCase()
    ) {
      return new Response("Stored file metadata mismatch", { status: 409 });
    }
    if (request.method === "HEAD") {
      return new Response(null, {
        headers: { ...common, "Content-Length": String(file.byteSize) },
      });
    }
    let range: ReturnType<typeof rangeOf>;
    try {
      range = rangeOf(request.headers.get("range"), file.byteSize);
    } catch {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${file.byteSize}` },
      });
    }
    if (range) {
      const ranged = await provider.getRange({ ref, ...range });
      return new Response(ranged.body, {
        status: 206,
        headers: {
          ...common,
          "Content-Length": String(range.endInclusive - range.start + 1),
          "Content-Range": `bytes ${range.start}-${range.endInclusive}/${file.byteSize}`,
        },
      });
    }
    return new Response(
      await provider.get({ ref, maxBytes: file.byteSize || 1 }),
      {
        headers: { ...common, "Content-Length": String(file.byteSize) },
      },
    );
  } catch (error) {
    if (!nodeUnavailable(error)) throw error;
    return Response.json(
      {
        error: {
          code: "NODE_STORAGE_CAPABILITY_OFFLINE",
          message:
            "Reconnect your Avermate Node or change the storage placement in Settings.",
          settingsPath: "/settings/node",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
