import { z } from "zod";
import {
  call,
  can,
  id,
  meta,
  runDestructive,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

function registerMaterialsSurface({
  server,
  api,
  principal,
  codec,
}: McpSurfaceContext): void {
  if (can(principal, "avermate:materials.read")) {
    const readMeta = meta("avermate:materials.read");
    const readOnly = { readOnlyHint: true };

    server.registerTool(
      "materials.folders.list",
      {
        description:
          "List the connected user's course-material folders for a year.",
        inputSchema: z.object({ yearId: id }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) => call(() => api.materials.folders.list(input)),
    );
    server.registerTool(
      "materials.documents.list",
      {
        description:
          "List course-material documents for a year, optionally restricted to one folder or the unfiled root.",
        inputSchema: z.object({
          yearId: id,
          folderId: id.nullable().optional(),
        }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) => call(() => api.materials.documents.list(input)),
    );
    server.registerTool(
      "materials.documents.get",
      {
        description:
          "Read one owned course-material source, including inline text, link, or stored-file metadata.",
        inputSchema: z.object({ documentId: id }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) => call(() => api.materials.documents.get(input)),
    );
    server.registerTool(
      "materials.documents.transcript",
      {
        description:
          "Read the machine-readable transcript for an owned course material. Pasted text is immediately ready; OCR-backed sources report idle, pending, ready, or failed state.",
        inputSchema: z.object({ documentId: id }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) => call(() => api.materials.documents.transcript(input)),
    );
    server.registerTool(
      "recordings.list",
      {
        description:
          "List the connected user's owned lecture recordings for a year, including capture and transcription status but no provider credentials.",
        inputSchema: z.object({ yearId: id }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) => call(() => api.recordings.list(input)),
    );
    server.registerTool(
      "recordings.transcript",
      {
        description:
          "Read the final timestamped transcript for one owned lecture recording. Audio file internals and transcription credentials are not returned.",
        inputSchema: z.object({ recordingId: id }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) =>
        call(async () => {
          const result = await api.recordings.get(input);
          return {
            recording: result.recording,
            transcript: result.transcript,
          };
        }),
    );
    server.registerTool(
      "sync.status",
      {
        description:
          "Read one owned academic-provider connection and its latest synchronization job status. Credentials and custom CA material are never returned.",
        inputSchema: z.object({ connectionId: id }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) => call(() => api.sync.status(input)),
    );
  }

  if (can(principal, "avermate:materials.write")) {
    const writeMeta = meta("avermate:materials.write");
    const title = z.string().trim().min(1).max(160);

    server.registerTool(
      "materials.folders.create",
      {
        description: "Create an owned course-material folder in a year.",
        inputSchema: z.object({
          yearId: id,
          name: title,
          parentId: id.nullable().default(null),
          subjectId: id.nullable().default(null),
        }),
        _meta: writeMeta,
      },
      (input) => call(() => api.materials.folders.create(input)),
    );
    server.registerTool(
      "sync.trigger",
      {
        description:
          "Enqueue an owned academic-provider synchronization and return its durable job identifier.",
        inputSchema: z.object({ connectionId: id }),
        _meta: writeMeta,
      },
      (input) => call(() => api.sync.run(input)),
    );
    server.registerTool(
      "materials.documents.transcribe",
      {
        description:
          "Idempotently enqueue OCR for an owned PDF or image course material and return the durable job identifier.",
        inputSchema: z.object({ documentId: id }),
        annotations: { idempotentHint: true },
        _meta: writeMeta,
      },
      (input) => call(() => api.materials.documents.transcribe(input)),
    );
    server.registerTool(
      "materials.documents.rename",
      {
        description: "Rename an owned course-material document.",
        inputSchema: z.object({ documentId: id, title }),
        _meta: writeMeta,
      },
      (input) => call(() => api.materials.documents.rename(input)),
    );
    server.registerTool(
      "materials.documents.move",
      {
        description:
          "Move an owned course-material document to another owned folder or the unfiled root.",
        inputSchema: z.object({ documentId: id, folderId: id.nullable() }),
        _meta: writeMeta,
      },
      (input) => call(() => api.materials.documents.move(input)),
    );
    server.registerTool(
      "materials.documents.delete",
      {
        description: "Permanently delete a course-material document.",
        inputSchema: z.object({
          documentId: id,
          idempotencyKey: z.string().uuid(),
        }),
        annotations: { destructiveHint: true, idempotentHint: true },
        _meta: writeMeta,
      },
      (input, context) =>
        runDestructive({
          principal,
          codec,
          toolName: "materials.documents.delete",
          input,
          context,
          description: `Delete material document ${input.documentId}.`,
          execute: () =>
            api.materials.documents.delete({ documentId: input.documentId }),
        }),
    );
    server.registerTool(
      "materials.folders.delete",
      {
        description:
          "Permanently delete a course-material folder, its descendants, and their documents.",
        inputSchema: z.object({
          folderId: id,
          idempotencyKey: z.string().uuid(),
        }),
        annotations: { destructiveHint: true, idempotentHint: true },
        _meta: writeMeta,
      },
      (input, context) =>
        runDestructive({
          principal,
          codec,
          toolName: "materials.folders.delete",
          input,
          context,
          description: `Delete material folder ${input.folderId} and its contents.`,
          execute: () =>
            api.materials.folders.delete({ folderId: input.folderId }),
        }),
    );
  }
}

export const materialsSurface: McpSurface = {
  scopes: ["avermate:read"],
  register: registerMaterialsSurface,
};
