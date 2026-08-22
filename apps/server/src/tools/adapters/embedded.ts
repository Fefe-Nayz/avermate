import type {
  ToolExecutionContext,
  ToolResultV1,
} from "@avermate/agent-contracts";
import type { ToolBroker, ToolBrokerInvocation } from "../broker";

/** Embedded runtimes consume only the model projection, never the raw result. */
export async function invokeBrokerFromEmbedded(input: {
  broker: ToolBroker;
  context: ToolExecutionContext;
  invocation: ToolBrokerInvocation;
}): Promise<ToolResultV1<unknown>> {
  return (await input.broker.invoke(input.context, input.invocation)).model;
}
