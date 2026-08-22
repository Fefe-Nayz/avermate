import type {
  ExternalToolCall,
  ToolCatalogContext,
  ToolExecutionContext,
  ToolSource,
  ToolSourceRequest,
  ToolSourceResponse,
  ToolSourceTransport,
  ToolSourceTransportLimits,
} from "@avermate/agent-contracts";

const encoder = new TextEncoder();

export class InProcessMcpSource implements ToolSource {
  readonly trust = "user-configured" as const;
  constructor(
    readonly sourceId: string,
    private readonly credential: string,
  ) {}
  listRequest(_context: ToolCatalogContext): ToolSourceRequest {
    return {
      method: "list",
      operation: "tools/list",
      body: encoder.encode("{}"),
      headers: { authorization: `Bearer ${this.credential}` },
    };
  }
  invokeRequest(
    _context: ToolExecutionContext,
    call: ExternalToolCall,
  ): ToolSourceRequest {
    return {
      method: "invoke",
      operation: "tools/call",
      body: encoder.encode(
        JSON.stringify({ name: call.remoteToolId, arguments: call.arguments }),
      ),
      headers: { authorization: `Bearer ${this.credential}` },
    };
  }
}

export class InProcessMcpTransport implements ToolSourceTransport {
  constructor(
    private readonly handler: (
      request: ToolSourceRequest,
      limits: ToolSourceTransportLimits,
      signal: AbortSignal,
    ) => Promise<ToolSourceResponse> | ToolSourceResponse,
  ) {}
  exchange(
    _source: ToolSource,
    request: ToolSourceRequest,
    limits: ToolSourceTransportLimits,
    signal: AbortSignal,
  ): Promise<ToolSourceResponse> {
    return Promise.resolve(this.handler(request, limits, signal));
  }
}

export function inProcessJsonResponse(
  value: unknown,
  options: { declaredBytes?: number; chunkSize?: number } = {},
): ToolSourceResponse {
  const bytes = encoder.encode(JSON.stringify(value));
  const chunkSize = options.chunkSize ?? (bytes.byteLength || 1);
  return {
    declaredBytes: options.declaredBytes ?? bytes.byteLength,
    contentType: "application/json",
    body: {
      async *[Symbol.asyncIterator]() {
        for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
          yield bytes.slice(offset, offset + chunkSize);
        }
      },
    },
  };
}
