import { z } from "zod";
import { createFirstPartyToolBroker } from "../../tools/first-party";
import { invokeBrokerFromMcp } from "../../tools/adapters/mcp";
import {
  brokerMeta,
  id,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

const sourceKind = z.enum([
  "material",
  "study-document",
  "recording",
  "grade",
  "subject",
  "artifact",
]);
function registerProjectsSurface({
  server,
  api,
  principal,
}: McpSurfaceContext) {
  const broker = createFirstPartyToolBroker(api);
  const readMeta = brokerMeta("avermate:read");
  const readOnly = { readOnlyHint: true };

  server.registerTool(
    "projects.list",
    {
      description: "List owned study projects without moving their sources.",
      inputSchema: z.object({
        include: z.enum(["live", "trashed", "all"]).default("live"),
        yearId: id.optional(),
      }),
      annotations: readOnly,
      _meta: readMeta,
    },
    (input) =>
      invokeBrokerFromMcp({
        broker,
        principal,
        invocation: { toolId: "projects.list", toolVersion: 1, input },
      }),
  );
  server.registerTool(
    "projects.get",
    {
      description: "Read one owned study project and its source references.",
      inputSchema: z.object({ projectId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    (input) =>
      invokeBrokerFromMcp({
        broker,
        principal,
        invocation: { toolId: "projects.get", toolVersion: 1, input },
      }),
  );
  server.registerTool(
    "search.query",
    {
      description:
        "Search the owned study corpus and return exact immutable citation IDs.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(2_000),
        mode: z.enum(["terms", "phrase", "prefix", "exact"]).default("terms"),
        projectIds: z.array(id).max(100).default([]),
        yearIds: z.array(id).max(100).default([]),
        subjectIds: z.array(id).max(100).default([]),
        originKinds: z.array(sourceKind).max(16).default([]),
        limit: z.number().int().min(1).max(20).default(10),
        cursor: z.string().max(512).nullable().default(null),
      }),
      annotations: readOnly,
      _meta: readMeta,
    },
    (input) =>
      invokeBrokerFromMcp({
        broker,
        principal,
        invocation: { toolId: "search.query", toolVersion: 1, input },
      }),
  );
  server.registerTool(
    "search.read_citation",
    {
      description: "Read a bounded exact passage for an owned citation ID.",
      inputSchema: z.object({
        citationId: id,
        maxChars: z.number().int().min(1).max(32_000).default(12_000),
      }),
      annotations: readOnly,
      _meta: readMeta,
    },
    (input) =>
      invokeBrokerFromMcp({
        broker,
        principal,
        invocation: {
          toolId: "search.read_citation",
          toolVersion: 1,
          input,
        },
      }),
  );
  server.registerTool(
    "search.index_status",
    {
      description: "Read truthful indexing state for one owned source.",
      inputSchema: z.object({ kind: sourceKind, referenceId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    (input) =>
      invokeBrokerFromMcp({
        broker,
        principal,
        invocation: { toolId: "search.index_status", toolVersion: 1, input },
      }),
  );
}

export const projectsSurface: McpSurface = {
  scopes: ["avermate:read"],
  register: registerProjectsSurface,
};
