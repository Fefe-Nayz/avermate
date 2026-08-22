import { Hono } from "hono";
import {
  fileHandleAudienceSchema,
  opaqueFileHandleSchema,
} from "@avermate/agent-contracts";
import type { FileHandleService } from "../tools/file-handles";

const exchangeSchema = {
  parse(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid exchange request");
    }
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).some((key) => key !== "handle" && key !== "operation")
    ) {
      throw new Error("Invalid exchange request");
    }
    return {
      handle: opaqueFileHandleSchema.parse(record.handle),
      operation: fileHandleAudienceSchema.parse(record.operation),
    };
  },
};

export type ExchangeOwnedFile = {
  id: string;
  userId: string;
  provider: string;
  storageKey: string;
  url: string;
  mimeType: string;
  byteSize: number;
  purpose: string;
  status: "stored" | "deleted";
};

export interface FileHandleRouteDependencies {
  authenticate(request: Request): Promise<{ userId: string } | null>;
  handles: FileHandleService;
  loadOwnedFile(
    userId: string,
    fileId: string,
  ): Promise<ExchangeOwnedFile | null>;
  reserve(
    userId: string,
    operation: "preview" | "download",
  ): Promise<void> | void;
  maxBytes(file: ExchangeOwnedFile, operation: "preview" | "download"): number;
  respond(
    request: Request,
    file: ExchangeOwnedFile,
    operation: "preview" | "download",
  ): Promise<Response>;
}

export function createFileHandleExchangeRoutes(
  dependencies: FileHandleRouteDependencies,
) {
  const routes = new Hono();
  routes.post("/file-handles/exchange", async (context) => {
    const session = await dependencies.authenticate(context.req.raw);
    if (!session)
      return context.json({ error: "Authentication required" }, 401);
    const declared = Number(context.req.header("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > 8 * 1024) {
      return context.json({ error: "The exchange request is too large" }, 413);
    }
    let exchange: ReturnType<typeof exchangeSchema.parse>;
    try {
      exchange = exchangeSchema.parse(await context.req.json());
    } catch {
      return context.json({ error: "Invalid file handle exchange" }, 400);
    }
    let resolved;
    try {
      resolved = await dependencies.handles.resolve({
        handle: exchange.handle,
        userId: session.userId,
        audience: exchange.operation,
      });
    } catch {
      return context.json({ error: "File not found" }, 404);
    }
    const file = await dependencies.loadOwnedFile(
      session.userId,
      resolved.fileId,
    );
    if (!file || file.userId !== session.userId || file.status !== "stored") {
      return context.json({ error: "File not found" }, 404);
    }
    if (
      file.byteSize < 0 ||
      file.byteSize > dependencies.maxBytes(file, exchange.operation)
    ) {
      return context.json(
        { error: "File is too large for this operation" },
        413,
      );
    }
    try {
      await dependencies.reserve(session.userId, exchange.operation);
    } catch {
      return context.json({ error: "Too many file exchanges" }, 429);
    }
    const response = await dependencies.respond(
      context.req.raw,
      file,
      exchange.operation,
    );
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  });
  return routes;
}
