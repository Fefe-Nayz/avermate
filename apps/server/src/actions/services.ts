import type { AgentActionActorKind } from "@avermate/agent-contracts";
import { db } from "../db";
import {
  ActionLedgerService,
  DurableToolActionLedgerWriter,
} from "./action-ledger";
import { managedToolActionContinuationStore } from "../tools/managed-action-continuation";

let singleton: ActionLedgerService | null = null;
let sweeperTimer: ReturnType<typeof setInterval> | null = null;

export function actionLedgerService(): ActionLedgerService {
  singleton ??= new ActionLedgerService(db.$client, {
    recomputeLearningMastery: async (userId, objectiveId) => {
      const { recomputeObjectiveMastery } = await import("../routers/learning");
      await recomputeObjectiveMastery(userId, objectiveId);
    },
  });
  return singleton;
}

export function durableActionLedgerWriter(input: {
  actorKind: AgentActionActorKind;
  userId: string;
}): DurableToolActionLedgerWriter {
  return new DurableToolActionLedgerWriter(
    actionLedgerService(),
    input.actorKind,
    input.userId,
  );
}

export function startActionApprovalSweeper(input?: {
  intervalMs?: number;
  workerId?: string;
}): () => void {
  if (sweeperTimer) return () => undefined;
  const workerId = input?.workerId ?? `actions:${crypto.randomUUID()}`;
  const sweep = () =>
    actionLedgerService()
      .expireApprovals({ workerId, limit: 100 })
      .then((expired) =>
        Promise.allSettled(
          expired.map(async (actionId) => {
            const action = await actionLedgerService().getSystem(actionId);
            if (action) {
              await managedToolActionContinuationStore.discard(
                action.userId,
                actionId,
              );
            }
          }),
        ),
      )
      .catch((error) =>
        console.error("[actions] approval expiry sweep failed", error),
      );
  void sweep();
  sweeperTimer = setInterval(
    sweep,
    Math.max(5_000, input?.intervalMs ?? 30_000),
  );
  (sweeperTimer as unknown as { unref?: () => void }).unref?.();
  return () => {
    if (!sweeperTimer) return;
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  };
}
