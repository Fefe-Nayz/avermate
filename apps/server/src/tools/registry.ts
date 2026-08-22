import { z } from "zod";
import type {
  AnyAvermateToolDescriptor,
  AvermateToolDescriptor,
} from "@avermate/agent-contracts";

const toolIdPattern = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/;

function key(id: string, version: number): string {
  return `${id}@${version}`;
}

function assertDescriptor(descriptor: AnyAvermateToolDescriptor): void {
  if (!toolIdPattern.test(descriptor.id) || descriptor.id.length > 256) {
    throw new Error(`Invalid stable tool ID: ${descriptor.id}`);
  }
  if (!Number.isInteger(descriptor.version) || descriptor.version < 1) {
    throw new Error(`Invalid descriptor version for ${descriptor.id}`);
  }
  if (descriptor.requiredScopes.length === 0) {
    throw new Error(`${descriptor.id} must declare at least one scope`);
  }
  if (
    new Set(descriptor.requiredScopes).size !== descriptor.requiredScopes.length
  ) {
    throw new Error(`${descriptor.id} declares duplicate scopes`);
  }
  if (descriptor.effect !== "read" && descriptor.idempotency === "none") {
    throw new Error(`${descriptor.id} mutation has no idempotency story`);
  }
  if (descriptor.compensation !== "none" && !descriptor.compensatorId) {
    throw new Error(
      `${descriptor.id} declares compensation without a reviewed compensator ID`,
    );
  }
  if (descriptor.compensation !== "none" && !descriptor.actionResources) {
    throw new Error(
      `${descriptor.id} declares compensation without resource revision fences`,
    );
  }
  if (
    descriptor.crashRecovery === "idempotent-retry" &&
    descriptor.idempotency !== "required"
  ) {
    throw new Error(
      `${descriptor.id} cannot retry a crash window without required idempotency`,
    );
  }
  if (descriptor.effect === "delete" && descriptor.approval !== "always") {
    throw new Error(
      `${descriptor.id} delete operations always require approval`,
    );
  }
  for (const [audience, projection] of Object.entries(
    descriptor.resultProjections,
  )) {
    try {
      z.toJSONSchema(projection.schema);
    } catch (error) {
      throw new Error(`${descriptor.id} has no JSON-safe ${audience} schema`, {
        cause: error,
      });
    }
  }
  z.toJSONSchema(descriptor.inputSchema);
}

export class ToolRegistry {
  readonly #byKey = new Map<string, AnyAvermateToolDescriptor>();
  readonly #ordered: AnyAvermateToolDescriptor[] = [];

  constructor(descriptors: readonly AnyAvermateToolDescriptor[] = []) {
    for (const descriptor of descriptors) this.register(descriptor);
  }

  register<I, O, M, U, A>(
    descriptor: AvermateToolDescriptor<I, O, M, U, A>,
  ): void {
    const erased = descriptor as unknown as AnyAvermateToolDescriptor;
    assertDescriptor(erased);
    const descriptorKey = key(descriptor.id, descriptor.version);
    if (this.#byKey.has(descriptorKey)) {
      throw new Error(`Duplicate tool descriptor: ${descriptorKey}`);
    }
    this.#byKey.set(descriptorKey, erased);
    this.#ordered.push(erased);
  }

  resolve(id: string, version: number): AnyAvermateToolDescriptor | null {
    return this.#byKey.get(key(id, version)) ?? null;
  }

  list(): readonly AnyAvermateToolDescriptor[] {
    return [...this.#ordered];
  }

  catalogue(): Array<{
    id: string;
    version: number;
    title: string;
    description: string;
    requiredScopes: readonly string[];
    effect: string;
    risk: string;
    approval: string;
    inputSchema: unknown;
  }> {
    return this.#ordered.map((descriptor) => ({
      id: descriptor.id,
      version: descriptor.version,
      title: descriptor.title,
      description: descriptor.description,
      requiredScopes: descriptor.requiredScopes,
      effect: descriptor.effect,
      risk: descriptor.risk,
      approval: descriptor.approval,
      inputSchema: z.toJSONSchema(descriptor.inputSchema),
    }));
  }
}
