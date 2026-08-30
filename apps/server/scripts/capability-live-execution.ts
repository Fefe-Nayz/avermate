import type {
  CapabilityKind,
  CapabilityRequestMap,
} from "@avermate/agent-contracts";
import type { CapabilityRegistryInvoker } from "../src/capabilities/registry-invoker";
import type { CapabilityRouteConstraint } from "../src/capabilities/registry-invoker";

/** Streaming providers must be exercised through the same lane as the assistant. */
export async function executeCapabilityLiveRequest(
  input: {
    ownerId: string;
    capability: CapabilityKind;
    purpose: string;
    request: CapabilityRequestMap[CapabilityKind];
    idempotencyKey: string;
    route?: CapabilityRouteConstraint;
  },
  invoker: Pick<CapabilityRegistryInvoker, "invoke" | "streamLanguage">,
) {
  if (input.capability === "language.generate") {
    for await (const _event of invoker.streamLanguage({
      ...input,
      request: input.request as CapabilityRequestMap["language.generate"],
    })) {
      // Consume the complete stream. Evidence is read from its persisted result,
      // never from partial output or an invented local result envelope.
    }
    return null;
  }
  return invoker.invoke(input);
}
