import type { AssistantThreadDetail } from "./assistant-types"

/**
 * The run a thread is currently busy with, if any.
 *
 * Shared by the conversation header and the conversation pane, which is why it
 * lives here rather than in either of them — a helper imported in both
 * directions is a cycle waiting to happen.
 */
export function activeRun(detail: AssistantThreadDetail | null) {
  if (!detail) return undefined
  return [...detail.runs]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .find((run) =>
      [
        "reserved",
        "running",
        "waiting-for-user",
        "waiting-approval",
        "cancelling",
      ].includes(run.status)
    )
}

/**
 * What the assistant may do, and where it runs.
 *
 * Both of these were in the composer: the approval mode as a dropdown beside
 * the send button, and the placement as a caption underneath. Neither is a
 * per-message decision — you do not pick a safety posture per sentence — and a
 * setting that sits in the writing bar is a setting you brush past rather than
 * read.
 *
 * They belong together because they answer the same question, which is the one
 * question worth answering before you type anything into an assistant: what can
 * this thing touch, and who else sees it. So one control in the header, showing
 * the current answer, opening the full one.
 */
