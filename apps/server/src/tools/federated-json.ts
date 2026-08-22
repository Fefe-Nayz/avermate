import type {
  ToolSource,
  ToolSourceRequest,
  ToolSourceTransport,
  ToolSourceTransportLimits,
} from "@avermate/agent-contracts";
import { ToolBrokerFault } from "./broker";

type ObjectFrame = {
  type: "object";
  state: "key-or-end" | "key" | "colon" | "value" | "comma-or-end";
  sensitiveKeys: Set<string>;
};
type ArrayFrame = {
  type: "array";
  state: "value-or-end" | "value" | "comma-or-end";
};
type Frame = ObjectFrame | ArrayFrame;

const sensitiveKey =
  /(^|[-_])(authorization|cookie|password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|private[-_]?key|user[-_]?id|scope|risk|approval)($|[-_])/i;

export class StreamingJsonInspector {
  readonly #stack: Frame[] = [];
  #root: "value" | "complete" = "value";
  #mode: "normal" | "string" | "primitive" = "normal";
  #token = "";
  #escaped = false;
  #items = 0;

  constructor(
    private readonly maxDepth: number,
    private readonly maxItems: number,
  ) {}

  #fault(message: string): never {
    throw new ToolBrokerFault("SOURCE_PROTOCOL_ERROR", message);
  }

  #top(): Frame | undefined {
    return this.#stack.at(-1);
  }

  #startValue(): void {
    const parent = this.#top();
    if (!parent) {
      if (this.#root !== "value") this.#fault("Trailing JSON is forbidden");
      return;
    }
    if (parent.type === "object") {
      if (parent.state !== "value") this.#fault("Unexpected JSON value");
      parent.state = "comma-or-end";
    } else {
      if (parent.state !== "value" && parent.state !== "value-or-end") {
        this.#fault("Unexpected JSON array value");
      }
      parent.state = "comma-or-end";
    }
    this.#items += 1;
    if (this.#items > this.maxItems) {
      this.#fault("External JSON exceeds the structural item budget");
    }
  }

  #finishScalar(): void {
    if (this.#stack.length === 0) this.#root = "complete";
  }

  #open(type: "object" | "array"): void {
    this.#startValue();
    if (this.#stack.length + 1 > this.maxDepth) {
      this.#fault("External JSON exceeds the structural depth budget");
    }
    this.#stack.push(
      type === "object"
        ? { type, state: "key-or-end", sensitiveKeys: new Set() }
        : { type, state: "value-or-end" },
    );
  }

  #close(type: "object" | "array"): void {
    const frame = this.#top();
    if (!frame || frame.type !== type) this.#fault("Mismatched JSON container");
    const closable =
      frame.type === "object"
        ? frame.state === "key-or-end" || frame.state === "comma-or-end"
        : frame.state === "value-or-end" || frame.state === "comma-or-end";
    if (!closable) this.#fault("Incomplete JSON container");
    this.#stack.pop();
    if (this.#stack.length === 0) this.#root = "complete";
  }

  #string(value: string): void {
    const frame = this.#top();
    if (
      frame?.type === "object" &&
      (frame.state === "key-or-end" || frame.state === "key")
    ) {
      if (sensitiveKey.test(value)) {
        const normalized = value.toLowerCase();
        if (frame.sensitiveKeys.has(normalized)) {
          this.#fault(`Duplicate security-sensitive JSON key: ${value}`);
        }
        frame.sensitiveKeys.add(normalized);
      }
      frame.state = "colon";
      return;
    }
    this.#startValue();
    this.#finishScalar();
  }

  #primitive(value: string): void {
    if (
      !/^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(
        value,
      )
    ) {
      this.#fault("Malformed JSON primitive");
    }
    this.#startValue();
    this.#finishScalar();
  }

  #normal(character: string): void {
    if (/\s/.test(character)) return;
    if (this.#root === "complete") this.#fault("Trailing JSON is forbidden");
    if (character === '"') {
      this.#mode = "string";
      this.#token = '"';
      this.#escaped = false;
      return;
    }
    if (character === "{") return this.#open("object");
    if (character === "[") return this.#open("array");
    if (character === "}") return this.#close("object");
    if (character === "]") return this.#close("array");
    if (character === ":") {
      const frame = this.#top();
      if (frame?.type !== "object" || frame.state !== "colon") {
        this.#fault("Unexpected JSON colon");
      }
      frame.state = "value";
      return;
    }
    if (character === ",") {
      const frame = this.#top();
      if (!frame || frame.state !== "comma-or-end") {
        this.#fault("Unexpected JSON comma");
      }
      frame.state = frame.type === "object" ? "key" : "value";
      return;
    }
    if (/[-0-9tfn]/.test(character)) {
      this.#mode = "primitive";
      this.#token = character;
      return;
    }
    this.#fault("Malformed JSON token");
  }

  feed(text: string): void {
    for (const character of text) {
      if (this.#mode === "string") {
        this.#token += character;
        if (this.#escaped) {
          this.#escaped = false;
          continue;
        }
        if (character === "\\") {
          this.#escaped = true;
          continue;
        }
        if (character === '"') {
          let value: unknown;
          try {
            value = JSON.parse(this.#token);
          } catch {
            this.#fault("Malformed JSON string");
          }
          if (typeof value !== "string") this.#fault("Invalid JSON string");
          this.#string(value);
          this.#mode = "normal";
          this.#token = "";
        }
        continue;
      }
      if (this.#mode === "primitive") {
        if (/\s|[\]}:,]/.test(character)) {
          this.#primitive(this.#token);
          this.#mode = "normal";
          this.#token = "";
          this.#normal(character);
        } else {
          this.#token += character;
        }
        continue;
      }
      this.#normal(character);
    }
  }

  finish(): void {
    if (this.#mode === "string") this.#fault("Unterminated JSON string");
    if (this.#mode === "primitive") {
      this.#primitive(this.#token);
      this.#mode = "normal";
      this.#token = "";
    }
    if (this.#stack.length > 0 || this.#root !== "complete") {
      this.#fault("Incomplete JSON document");
    }
  }
}

function deadlineFault(): ToolBrokerFault {
  return new ToolBrokerFault(
    "DEADLINE_EXCEEDED",
    "External tool source timed out",
  );
}

async function before<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T> {
  if (milliseconds <= 0) throw deadlineFault();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(deadlineFault()), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function exchangeToolSourceJson(input: {
  source: ToolSource;
  request: ToolSourceRequest;
  transport: ToolSourceTransport;
  limits: ToolSourceTransportLimits;
  signal: AbortSignal;
}): Promise<unknown> {
  const startedAt = Date.now();
  if (input.signal.aborted) throw input.signal.reason;
  const response = await before(
    input.transport.exchange(
      input.source,
      input.request,
      input.limits,
      input.signal,
    ),
    Math.min(input.limits.connectDeadlineMs, input.limits.totalDeadlineMs),
  );
  if (!/(?:^|\/)json(?:$|;)|\+json(?:$|;)/i.test(response.contentType)) {
    throw new ToolBrokerFault(
      "SOURCE_PROTOCOL_ERROR",
      "External source did not return JSON",
    );
  }
  if (
    response.declaredBytes !== undefined &&
    (!Number.isSafeInteger(response.declaredBytes) ||
      response.declaredBytes < 0)
  ) {
    throw new ToolBrokerFault(
      "SOURCE_PROTOCOL_ERROR",
      "Invalid declared response size",
    );
  }
  if (
    response.declaredBytes !== undefined &&
    response.declaredBytes > input.limits.maxBytes
  ) {
    throw new ToolBrokerFault(
      "RESULT_BUDGET_EXCEEDED",
      "Declared response is too large",
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const inspector = new StreamingJsonInspector(
    input.limits.maxDepth,
    input.limits.maxItems,
  );
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const iterator = response.body[Symbol.asyncIterator]();
  try {
    while (true) {
      if (input.signal.aborted) throw input.signal.reason;
      const remaining = input.limits.totalDeadlineMs - (Date.now() - startedAt);
      const item = await before(iterator.next(), remaining);
      if (item.done) break;
      if (!(item.value instanceof Uint8Array)) {
        throw new ToolBrokerFault(
          "SOURCE_PROTOCOL_ERROR",
          "External source yielded non-bytes",
        );
      }
      bytes += item.value.byteLength;
      if (bytes > input.limits.maxBytes) {
        throw new ToolBrokerFault(
          "RESULT_BUDGET_EXCEEDED",
          "External response is too large",
        );
      }
      const copy = item.value.slice();
      chunks.push(copy);
      inspector.feed(decoder.decode(copy, { stream: true }));
    }
    inspector.feed(decoder.decode());
    inspector.finish();
  } catch (error) {
    await iterator.return?.().catch(() => undefined);
    throw error;
  }
  if (
    response.declaredBytes !== undefined &&
    response.declaredBytes !== bytes
  ) {
    throw new ToolBrokerFault(
      "SOURCE_PROTOCOL_ERROR",
      "Declared response size did not match body",
    );
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Materialization happens only after byte, time and structural inspection.
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
}
