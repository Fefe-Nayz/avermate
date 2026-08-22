import { z } from "zod";
import { studyDocumentMetaSchema } from "../../lib/study-document-content";
import {
  brokerMeta,
  call,
  can,
  id,
  meta,
  runDestructive,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";
import { createFirstPartyToolBroker } from "../../tools/first-party";
import { invokeBrokerFromMcp } from "../../tools/adapters/mcp";

const title = z.string().trim().min(1).max(160);
const bodyMarkdown = z.string().max(512 * 1024);
const source = z
  .object({
    kind: z.enum(["subject", "materialDocument", "grade"]),
    referenceId: id,
  })
  .strict();

function registerDocumentsSurface({
  server,
  api,
  principal,
  codec,
}: McpSurfaceContext): void {
  if (can(principal, "avermate:documents.read")) {
    const readMeta = brokerMeta("avermate:documents.read");
    const readOnly = { readOnlyHint: true };
    const broker = createFirstPartyToolBroker(api);

    server.registerTool(
      "documents.list",
      {
        description:
          "List the connected user's fiches, notes, mind maps and slide decks for a year, optionally restricted to one materials folder or the unfiled root.",
        inputSchema: z
          .object({
            yearId: id,
            folderId: id.nullable().optional(),
          })
          .strict(),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: { toolId: "documents.list", toolVersion: 1, input },
        }),
    );
    server.registerTool(
      "documents.get",
      {
        description:
          "Read one owned study document with bounded reader-safe Markdown, current revision, references and timestamps. Quiz corrections are never returned.",
        inputSchema: z.object({ documentId: id }).strict(),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: { toolId: "documents.get", toolVersion: 1, input },
        }),
    );
    server.registerTool(
      "documents.downloadPptx",
      {
        description:
          "Compatibility-only PPTX download name. It remains fail-closed until its signed-URL result is replaced by Avermate's opaque file-handle exchange.",
        inputSchema: z
          .object({
            documentId: id,
            revision: z.number().int().min(1),
          })
          .strict(),
        annotations: readOnly,
        _meta: readMeta,
      },
      () =>
        Promise.resolve({
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "documents.downloadPptx requires an opaque file-handle migration",
            },
          ],
          structuredContent: {
            ok: false,
            error: {
              code: "AGENT_TOOL_NOT_AVAILABLE",
              message:
                "documents.downloadPptx requires an opaque file-handle migration",
              retryable: false,
            },
          },
        }),
    );
  }

  if (can(principal, "avermate:documents.write")) {
    const writeMeta = meta("avermate:documents.write");

    server.registerTool(
      "documents.create",
      {
        description:
          "Create an owned study document. fiche/note use bodyMarkdown and optional {emoji,color} metaJson; slides use bodyMarkdown split by a thematic-break line containing --- outside fenced code plus metaJson {version:1}; mindmap requires an empty body and metaJson {version:1,root:{id,label,note?,children?}}. To attach sources, create first and then call documents.update with the returned revision.",
        inputSchema: z
          .object({
            yearId: id,
            kind: z
              .enum(["fiche", "note", "mindmap", "slides"])
              .default("fiche"),
            title,
            bodyMarkdown: bodyMarkdown.default(""),
            metaJson: studyDocumentMetaSchema.nullable().default(null),
            folderId: id.nullable().default(null),
            subjectId: id.nullable().default(null),
          })
          .strict(),
        _meta: writeMeta,
      },
      (input) => call(() => api.documents.create(input)),
    );
    server.registerTool(
      "documents.update",
      {
        description:
          "Update an owned fiche, note, mind map or slide deck. Read first and pass its revision; stale revisions are rejected. For mind maps pass the complete structured metaJson tree; for slides pass separator-based bodyMarkdown and {version:1} metaJson. Pass sources to replace cited references.",
        inputSchema: z
          .object({
            documentId: id,
            revision: z.number().int().min(1),
            title: title.optional(),
            bodyMarkdown: bodyMarkdown.optional(),
            metaJson: studyDocumentMetaSchema.nullable().optional(),
            folderId: id.nullable().optional(),
            subjectId: id.nullable().optional(),
            sources: z.array(source).max(100).optional(),
          })
          .strict(),
        _meta: writeMeta,
      },
      (input) => call(() => api.documents.update(input)),
    );
    server.registerTool(
      "documents.exportPptx",
      {
        description:
          "Enqueue a revision-fenced, idempotent PPTX export for an owned slides document. Poll jobs.get with the returned jobId, then call documents.downloadPptx with this documentId and the successful result revision to mint a short-lived URL. Job results never contain a download URL. Dense source slides may become continuation slides so text and fenced code are preserved; an export requiring more than 250 generated slides is rejected without truncation.",
        inputSchema: z.object({ documentId: id }).strict(),
        annotations: { idempotentHint: true },
        _meta: writeMeta,
      },
      (input) => call(() => api.documents.exportPptx(input)),
    );
    server.registerTool(
      "documents.delete",
      {
        description: "Permanently delete an owned study document.",
        inputSchema: z
          .object({
            documentId: id,
            idempotencyKey: z.string().uuid(),
          })
          .strict(),
        annotations: { destructiveHint: true, idempotentHint: true },
        _meta: writeMeta,
      },
      (input, context) =>
        runDestructive({
          principal,
          codec,
          toolName: "documents.delete",
          input,
          context,
          description: `Delete study document ${input.documentId}.`,
          execute: () => api.documents.delete({ documentId: input.documentId }),
        }),
    );
  }
}

export const documentsSurface: McpSurface = {
  scopes: ["avermate:read"],
  register: registerDocumentsSurface,
};
