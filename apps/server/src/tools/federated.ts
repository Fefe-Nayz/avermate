import {
  enforceFederatedRiskFloor,
  externalToolCatalogSchema,
  namespacedExternalToolId,
  type ExternalToolCall,
  type ExternalToolCatalog,
  type ToolExecutionContext,
  type ToolSource,
  type ToolSourceTransport,
  type ToolSourceTransportLimits,
} from "@avermate/agent-contracts";
import { exchangeToolSourceJson } from "./federated-json";
import { ToolBrokerFault } from "./broker";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stable(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type ReviewedFederatedCatalog = {
  sourceId: string;
  snapshot: string;
  catalog: ExternalToolCatalog;
  tools: Array<
    ExternalToolCatalog["tools"][number] & {
      namespacedId: string;
      effectiveRisk: ReturnType<typeof enforceFederatedRiskFloor>;
    }
  >;
};

export class FederatedToolSourceBroker {
  readonly #reviewed = new Map<string, ReviewedFederatedCatalog>();

  constructor(
    private readonly transport: ToolSourceTransport,
    private readonly limits: ToolSourceTransportLimits,
  ) {}

  async inspect(
    source: ToolSource,
    context: {
      principal: { userId: string; clientId: string };
      signal: AbortSignal;
    },
  ): Promise<ReviewedFederatedCatalog> {
    const raw = await exchangeToolSourceJson({
      source,
      request: source.listRequest(context),
      transport: this.transport,
      limits: this.limits,
      signal: context.signal,
    });
    const catalog = externalToolCatalogSchema.parse(raw);
    const ids = new Set<string>();
    const tools = catalog.tools.map((tool) => {
      const namespacedId = namespacedExternalToolId(source.sourceId, tool.id);
      if (ids.has(namespacedId)) {
        throw new ToolBrokerFault(
          "SOURCE_PROTOCOL_ERROR",
          "Duplicate external tool ID",
        );
      }
      ids.add(namespacedId);
      return {
        ...tool,
        namespacedId,
        effectiveRisk: enforceFederatedRiskFloor(
          tool.advertisedRisk,
          source.trust,
        ),
      };
    });
    return {
      sourceId: source.sourceId,
      snapshot: await digest(catalog),
      catalog,
      tools,
    };
  }

  review(catalog: ReviewedFederatedCatalog): void {
    this.#reviewed.set(catalog.sourceId, structuredClone(catalog));
  }

  reviewed(sourceId: string): ReviewedFederatedCatalog | null {
    return this.#reviewed.get(sourceId) ?? null;
  }

  async assertUnchanged(
    source: ToolSource,
    context: {
      principal: { userId: string; clientId: string };
      signal: AbortSignal;
    },
  ): Promise<ReviewedFederatedCatalog> {
    const reviewed = this.#reviewed.get(source.sourceId);
    if (!reviewed) {
      throw new ToolBrokerFault(
        "SOURCE_SNAPSHOT_CHANGED",
        "Source has no reviewed snapshot",
      );
    }
    const current = await this.inspect(source, context);
    if (current.snapshot !== reviewed.snapshot) {
      throw new ToolBrokerFault(
        "SOURCE_SNAPSHOT_CHANGED",
        "External capability snapshot changed",
      );
    }
    return reviewed;
  }

  async invoke(
    source: ToolSource,
    context: ToolExecutionContext,
    call: ExternalToolCall,
  ): Promise<unknown> {
    const reviewed = this.#reviewed.get(source.sourceId);
    if (!reviewed || reviewed.snapshot !== call.capabilitySnapshot) {
      throw new ToolBrokerFault(
        "SOURCE_SNAPSHOT_CHANGED",
        "Capability snapshot is not reviewed",
      );
    }
    if (!reviewed.catalog.tools.some((tool) => tool.id === call.remoteToolId)) {
      throw new ToolBrokerFault(
        "TOOL_NOT_FOUND",
        "External tool is not in the reviewed snapshot",
      );
    }
    return exchangeToolSourceJson({
      source,
      request: source.invokeRequest(context, call),
      transport: this.transport,
      limits: this.limits,
      signal: context.signal,
    });
  }
}
