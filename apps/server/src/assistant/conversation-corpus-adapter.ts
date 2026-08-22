import type { Client } from "@libsql/client";
import type { OwnedSourceIdentity } from "@avermate/agent-contracts";
import {
  createCoreSourceRegistry,
  type IndexableSourceAdapter,
  type IndexableSourceSnapshot,
  type SourceDescriptor,
} from "../search/adapters";
import { canonicalJson, sha256 } from "../search/values";

type SqlClient = Pick<Client, "execute">;

export class ConversationIndexableSourceAdapter implements IndexableSourceAdapter {
  readonly kind = "conversation" as const;

  constructor(private readonly client: SqlClient) {}

  private async thread(input: OwnedSourceIdentity) {
    if (input.originKind !== "conversation") {
      throw new Error("Conversation adapter received another source kind");
    }
    const result = await this.client.execute({
      sql: `SELECT * FROM assistant_threads
        WHERE id = ? AND userId = ? AND placement = 'core' AND deletedAt IS NULL
        LIMIT 1`,
      args: [input.originId, input.ownerId],
    });
    const row = result.rows[0];
    if (!row) throw new Error("Conversation was not found or is not owned");
    return row;
  }

  async describe(input: OwnedSourceIdentity): Promise<SourceDescriptor> {
    const row = await this.thread(input);
    return {
      identity: input,
      title: String(row.title),
      yearId: null,
      subjectId: null,
      coverage: "searchable-native-text",
    };
  }

  async extract(input: OwnedSourceIdentity): Promise<IndexableSourceSnapshot> {
    const thread = await this.thread(input);
    const messages = await this.client.execute({
      sql: `SELECT id, role, authorship, partsJson, createdAt
        FROM assistant_messages WHERE threadId = ? AND status = 'complete'
        ORDER BY createdAt, id`,
      args: [input.originId],
    });
    const blocks = messages.rows.flatMap((row) => {
      const parts =
        typeof row.partsJson === "string"
          ? (JSON.parse(row.partsJson) as Array<Record<string, unknown>>)
          : (row.partsJson as unknown as Array<Record<string, unknown>>);
      const text = parts
        .filter(
          (part) => part.type === "text" && typeof part.markdown === "string",
        )
        .map((part) => String(part.markdown))
        .join("\n\n")
        .trim();
      if (!text) return [];
      return [
        {
          text: `${row.role === "user" ? "Utilisateur" : "Assistant"}: ${text}`,
          locator: {
            kind: "markdown" as const,
            headingPath: [`Message ${String(row.id)}`],
          },
          headingPath: [`Message ${String(row.id)}`],
          evidenceKind: "native-text" as const,
        },
      ];
    });
    return {
      ...(await this.describe(input)),
      versionKey: sha256(
        canonicalJson([
          thread.revision,
          thread.updatedAt,
          messages.rows.map((row) => [row.id, row.partsJson]),
        ]),
      ),
      extractorId: "avermate.conversation-dag",
      extractorVersion: "1",
      mimeType: "text/markdown",
      language: null,
      metadata: {
        title: String(thread.title),
        trust: "untrusted-user-and-model-content",
      },
      blocks,
    };
  }
}

export function createAssistantSourceRegistry(client: SqlClient) {
  return createCoreSourceRegistry(client).register(
    new ConversationIndexableSourceAdapter(client),
  );
}
