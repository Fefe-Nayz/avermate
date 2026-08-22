import { describe, expect, test } from "bun:test";
import { FileHandleService } from "../tools/file-handles";
import {
  createFileHandleExchangeRoutes,
  type ExchangeOwnedFile,
} from "./file-handles-core";

const secret = "test-only-file-handle-secret-that-is-long-enough-0123456789";
const file: ExchangeOwnedFile = {
  id: "file-1",
  userId: "user-1",
  provider: "local",
  storageKey: "private/course-material/user-1/opaque/document.pdf",
  url: "/api/files/file-1",
  mimeType: "application/pdf",
  byteSize: 42,
  purpose: "course-material",
  status: "stored",
};

describe("opaque file handle exchange", () => {
  test("encrypts identity and binds owner, audience and expiry", async () => {
    const handles = new FileHandleService(secret);
    const now = new Date("2026-08-22T10:00:00.000Z");
    const minted = await handles.mint({
      fileId: file.id,
      userId: file.userId,
      audience: "preview",
      mimeType: file.mimeType,
      byteSize: file.byteSize,
      ttlMs: 60_000,
      now,
    });
    expect(minted.handle).not.toContain(file.id);
    expect(minted.handle).not.toContain(file.storageKey);
    expect(
      await handles.resolve({
        handle: minted.handle,
        userId: file.userId,
        audience: "preview",
        now: new Date(now.getTime() + 1_000),
      }),
    ).toMatchObject({ fileId: file.id, userId: file.userId });
    await expect(
      handles.resolve({
        handle: minted.handle,
        userId: "user-2",
        audience: "preview",
        now,
      }),
    ).rejects.toThrow("invalid or unavailable");
    await expect(
      handles.resolve({
        handle: minted.handle,
        userId: file.userId,
        audience: "download",
        now,
      }),
    ).rejects.toThrow("invalid or unavailable");
    await expect(
      handles.resolve({
        handle: minted.handle,
        userId: file.userId,
        audience: "preview",
        now: new Date(now.getTime() + 60_001),
      }),
    ).rejects.toThrow("invalid or unavailable");
  });

  test("rejects tampering", async () => {
    const handles = new FileHandleService(secret);
    const minted = await handles.mint({
      fileId: file.id,
      userId: file.userId,
      audience: "download",
      mimeType: file.mimeType,
      byteSize: file.byteSize,
    });
    const final = minted.handle.at(-1) === "a" ? "b" : "a";
    await expect(
      handles.resolve({
        handle: `${minted.handle.slice(0, -1)}${final}`,
        userId: file.userId,
        audience: "download",
      }),
    ).rejects.toThrow("invalid or unavailable");
  });

  test("rechecks current ownership and revocation before serving", async () => {
    const handles = new FileHandleService(secret);
    const minted = await handles.mint({
      fileId: file.id,
      userId: file.userId,
      audience: "preview",
      mimeType: file.mimeType,
      byteSize: file.byteSize,
    });
    let current: ExchangeOwnedFile | null = file;
    const routes = createFileHandleExchangeRoutes({
      authenticate: async () => ({ userId: file.userId }),
      handles,
      loadOwnedFile: async (userId, fileId) =>
        current?.userId === userId && current.id === fileId ? current : null,
      reserve: () => undefined,
      maxBytes: () => 100,
      respond: async () => new Response("pdf-bytes", { status: 200 }),
    });
    const request = () =>
      routes.request("/file-handles/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: minted.handle, operation: "preview" }),
      });
    const served = await request();
    expect(served.status).toBe(200);
    expect(served.headers.get("cache-control")).toBe("private, no-store");
    current = { ...file, status: "deleted" };
    expect((await request()).status).toBe(404);
    current = { ...file, userId: "user-2" };
    expect((await request()).status).toBe(404);
  });

  test("never accepts a handle for a different expected operation", async () => {
    const handles = new FileHandleService(secret);
    const minted = await handles.mint({
      fileId: file.id,
      userId: file.userId,
      audience: "preview",
      mimeType: file.mimeType,
      byteSize: file.byteSize,
    });
    const routes = createFileHandleExchangeRoutes({
      authenticate: async () => ({ userId: file.userId }),
      handles,
      loadOwnedFile: async () => file,
      reserve: () => undefined,
      maxBytes: () => 100,
      respond: async () => new Response("should not run"),
    });
    const response = await routes.request("/file-handles/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: minted.handle, operation: "download" }),
    });
    expect(response.status).toBe(404);
  });
});
