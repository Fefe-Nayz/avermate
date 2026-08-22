import { z } from "zod";
import {
  brokerMeta,
  call,
  can,
  id,
  runDestructive,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";
import { createFirstPartyToolBroker } from "../../tools/first-party";
import { invokeBrokerFromMcp } from "../../tools/adapters/mcp";
import { fileHandleService } from "../../routes/file-handles";
import { managedToolActionContinuationStore } from "../../tools/managed-action-continuation";

function registerMaterialsSurface({
  server,
  api,
  principal,
  codec,
}: McpSurfaceContext): void {
  const broker = createFirstPartyToolBroker(api, {
    fileHandles: fileHandleService,
    ownerId: principal.userId,
  });
  if (can(principal, "avermate:materials.read")) {
    const readMeta = brokerMeta("avermate:materials.read");
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
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: {
            toolId: "materials.folders.list",
            toolVersion: 1,
            input,
          },
        }),
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
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: {
            toolId: "materials.documents.list",
            toolVersion: 1,
            input,
          },
        }),
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
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: {
            toolId: "materials.documents.get",
            toolVersion: 1,
            input,
          },
        }),
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
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: {
            toolId: "materials.documents.transcript",
            toolVersion: 1,
            input,
          },
        }),
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
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: { toolId: "recordings.list", toolVersion: 1, input },
        }),
    );
    server.registerTool(
      "source.ingestion_status",
      {
        description:
          "Read immutable ingestion revisions and stable failure reasons for one owned material source.",
        inputSchema: z.object({ documentId: id }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: {
            toolId: "source.ingestion_status",
            toolVersion: 1,
            input,
          },
        }),
    );
    server.registerTool(
      "artifact.list",
      {
        description:
          "List owned generated artifact identities and promoted revisions.",
        inputSchema: z.object({ projectId: id.nullable().default(null) }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: { toolId: "artifact.list", toolVersion: 1, input },
        }),
    );
    server.registerTool(
      "artifact.get_manifest",
      {
        description: "Read one exact immutable artifact revision manifest.",
        inputSchema: z.object({ artifactRevisionId: id }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: {
            toolId: "artifact.get_manifest",
            toolVersion: 1,
            input,
          },
        }),
    );
    server.registerTool(
      "artifact.workflow",
      {
        description:
          "Read durable stages, attempts, progress and failure reasons.",
        inputSchema: z.object({ runId: id }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: { toolId: "artifact.workflow", toolVersion: 1, input },
        }),
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
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: {
            toolId: "recordings.transcript",
            toolVersion: 1,
            input,
          },
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
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: { toolId: "sync.status", toolVersion: 1, input },
        }),
    );
  }

  if (can(principal, "avermate:materials.write")) {
    const writeMeta = brokerMeta("avermate:materials.write");
    const title = z.string().trim().min(1).max(160);
    const writeBroker = createFirstPartyToolBroker(api, {
      includeMutations: true,
      continuations: managedToolActionContinuationStore,
    });
    const artifactKind = z.enum([
      "markdown",
      "latex-source",
      "pdf",
      "slides-source",
      "pptx",
      "quiz",
      "audio",
      "image",
      "anki",
      "html",
      "video-timeline",
      "video",
      "thumbnail",
    ]);

    server.registerTool(
      "artifact.plan",
      {
        description:
          "Create an inspectable artifact workflow plan through the durable action ledger; this does not execute a renderer in the API process.",
        inputSchema: z.object({
          projectId: id.nullable().default(null),
          kind: artifactKind,
          title,
          sourceVersionIds: z.array(id).max(5_000).default([]),
          parentArtifactRevisionIds: z.array(id).max(100).default([]),
          settings: z.record(z.string(), z.unknown()).default({}),
          idempotencyKey: z.string().trim().min(8).max(256),
        }),
        annotations: { idempotentHint: true },
        _meta: writeMeta,
      },
      ({ idempotencyKey, ...input }) =>
        invokeBrokerFromMcp({
          broker: writeBroker,
          principal,
          invocation: {
            toolId: "artifact.plan",
            toolVersion: 1,
            input,
            idempotencyKey,
          },
        }),
    );
    server.registerTool(
      "artifact.cancel",
      {
        description:
          "Request cooperative cancellation of an owned artifact workflow through the durable action ledger.",
        inputSchema: z.object({
          runId: id,
          idempotencyKey: z.string().trim().min(8).max(256),
        }),
        annotations: { idempotentHint: true, destructiveHint: true },
        _meta: writeMeta,
      },
      ({ idempotencyKey, ...input }) =>
        invokeBrokerFromMcp({
          broker: writeBroker,
          principal,
          invocation: {
            toolId: "artifact.cancel",
            toolVersion: 1,
            input,
            idempotencyKey,
          },
        }),
    );
    server.registerTool(
      "artifact.retry_stage",
      {
        description:
          "Prepare one failed artifact stage for a bounded ledgered retry.",
        inputSchema: z.object({
          runId: id,
          stageId: id,
          idempotencyKey: z.string().trim().min(8).max(256),
        }),
        annotations: { idempotentHint: true },
        _meta: writeMeta,
      },
      ({ idempotencyKey, ...input }) =>
        invokeBrokerFromMcp({
          broker: writeBroker,
          principal,
          invocation: {
            toolId: "artifact.retry_stage",
            toolVersion: 1,
            input,
            idempotencyKey,
          },
        }),
    );
    server.registerTool(
      "artifact.promote",
      {
        description:
          "Promote one exact ready artifact revision behind a revision fence.",
        inputSchema: z.object({
          artifactId: id,
          artifactRevisionId: id,
          expectedIdentityRevision: z.number().int().positive(),
          idempotencyKey: z.string().trim().min(8).max(256),
        }),
        annotations: { idempotentHint: true },
        _meta: writeMeta,
      },
      ({ idempotencyKey, ...input }) =>
        invokeBrokerFromMcp({
          broker: writeBroker,
          principal,
          invocation: {
            toolId: "artifact.promote",
            toolVersion: 1,
            input,
            idempotencyKey,
          },
        }),
    );
    server.registerTool(
      "artifact.set_state",
      {
        description:
          "Archive, restore, or trash an artifact identity without deleting immutable revisions.",
        inputSchema: z.object({
          artifactId: id,
          expectedIdentityRevision: z.number().int().positive(),
          state: z.enum(["active", "archived", "trashed"]),
          idempotencyKey: z.string().trim().min(8).max(256),
        }),
        annotations: { idempotentHint: true },
        _meta: writeMeta,
      },
      ({ idempotencyKey, ...input }) =>
        invokeBrokerFromMcp({
          broker: writeBroker,
          principal,
          invocation: {
            toolId: "artifact.set_state",
            toolVersion: 1,
            input,
            idempotencyKey,
          },
        }),
    );

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
