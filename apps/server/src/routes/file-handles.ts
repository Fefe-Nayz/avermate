import { and, eq } from "drizzle-orm";
import { auth } from "../lib/auth";
import { db } from "../db";
import { files } from "../db/schema";
import { isSuspensionActive } from "../lib/access-policy";
import { env } from "../lib/env";
import { reserveRateLimit } from "../lib/rate-limit";
import { FILE_CONSTRAINTS, fileAccessUrl } from "../lib/storage";
import { localObjectPath } from "../lib/storage-backend";
import { FileHandleService } from "../tools/file-handles";
import { nodeFileResponse } from "../node/node-file-response";
import {
  createFileHandleExchangeRoutes,
  type ExchangeOwnedFile,
} from "./file-handles-core";

export const fileHandleService = new FileHandleService(
  env.MCP_REQUEST_STATE_SECRET ?? env.BETTER_AUTH_SECRET,
);

function dispositionName(file: ExchangeOwnedFile) {
  const name = file.storageKey.split("/").at(-1) ?? "download";
  return encodeURIComponent(name.replace(/[\r\n]/g, "").slice(0, 160));
}

async function localFileResponse(
  request: Request,
  file: ExchangeOwnedFile,
  operation: "preview" | "download",
) {
  const body = Bun.file(localObjectPath(file.storageKey));
  if (!(await body.exists()))
    return new Response("File not found", { status: 404 });
  const common = {
    "Content-Type": file.mimeType,
    "Content-Disposition": `${operation === "preview" ? "inline" : "attachment"}; filename*=UTF-8''${dispositionName(file)}`,
    "Accept-Ranges": "bytes",
  };
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = Math.min(
      file.byteSize - 1,
      range[2] ? Number(range[2]) : file.byteSize - 1,
    );
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end
    ) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${file.byteSize}` },
      });
    }
    return new Response(body.slice(start, end + 1), {
      status: 206,
      headers: {
        ...common,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${file.byteSize}`,
      },
    });
  }
  return new Response(body, {
    headers: { ...common, "Content-Length": String(file.byteSize) },
  });
}

export const fileHandleRoutes = createFileHandleExchangeRoutes({
  authenticate: async (request) => {
    const session = await auth.api.getSession({ headers: request.headers });
    return session &&
      session.user.emailVerified &&
      !isSuspensionActive(session.user)
      ? { userId: session.user.id }
      : null;
  },
  handles: fileHandleService,
  loadOwnedFile: async (userId, fileId) => {
    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, userId)))
      .limit(1);
    return file ?? null;
  },
  reserve: (userId, operation) =>
    reserveRateLimit({
      subject: userId,
      action: `files.handle.${operation}`,
      limit: operation === "preview" ? 240 : 120,
      windowMs: 60 * 60_000,
    }),
  maxBytes: (file) =>
    FILE_CONSTRAINTS[file.purpose as keyof typeof FILE_CONSTRAINTS]?.maxBytes ??
    0,
  respond: async (request, file, operation) => {
    if (file.provider === "local")
      return localFileResponse(request, file, operation);
    if (file.provider === "s3") {
      const location = await fileAccessUrl(file, { expiresIn: "5m" });
      return new Response(null, {
        status: 302,
        headers: { Location: location },
      });
    }
    const response = await nodeFileResponse(request, file, {
      disposition: operation === "preview" ? "inline" : "attachment",
    });
    if (response) return response;
    return new Response("File not found", { status: 404 });
  },
});
