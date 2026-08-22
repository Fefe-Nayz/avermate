# Fichr chat POC: portable design evidence

## Source and inspection boundary

This note records a read-only review of the public
[Fichr repository](https://github.com/Fefe-Nayz/Fichr) at commit
`b8c571440d85a965a820d5d3a42689db60146d64` (2026-01-26).

The review was limited to source structure and interaction contracts. The
committed chat database, conversations, local configuration, environment
values and user content were deliberately not opened or copied. This document
contains no source excerpt and is evidence for product decisions, not porting
material.

## Useful interaction ideas observed

- A side panel listed conversations and supported title/content search, a new
  conversation flow and deletion. A rename endpoint existed, although a
  complete rename interaction was not established by this review.
- The composer exposed a model picker instead of binding every conversation to
  one hard-coded provider.
- Assistant output streamed incrementally. Tool start, completion and error
  events appeared as status blocks alongside the answer.
- Individual messages could be copied. A complete JSON or Markdown
  conversation export was not observed and must not be claimed as inherited
  functionality.
- Editing a user message and retrying an assistant message created alternative
  children rather than overwriting the previous result. Previous/next controls
  navigated the active branch.
- Course search, project/document operations and generated-document builds
  were presented as agent tools, which validated the value of keeping study
  work inside the learning workspace.

These are product observations only. Their persistence, concurrency and safety
properties were not sufficient for Avermate.

## Architectural failures not to reproduce

### Persistence and runtime were coupled

Conversation persistence, branch reconstruction, provider-session setup,
workspace access and tool definitions met inside one application-specific chat
runtime. The client also reconstructed and selected the active message tree in
local component state. This made persisted history, the active UI projection
and an in-flight run difficult to distinguish or resume independently.

Avermate instead requires a durable message DAG, an append-only event stream
and separately identified harness checkpoints. The selected conversation store
must be authoritative, and reconnect must replay persisted events rather than
guessing from the last rendered component state.

### Approval happened after execution

Destructive and command tools carried an approval boolean in their displayed
result, but the operation had already run before that result was emitted. The
label therefore described risk after the side effect; it was not a security
boundary.

Avermate approvals must pause before execution, bind the exact normalized
arguments and principal, expire safely, and resume at most once. Mutating
domain operations also need an auditable action ledger and an explicit
compensation or non-reversible result.

### A generic shell crossed the trust boundary

The POC exposed arbitrary command execution from the same backend that held
chat persistence and workspace access. Command strings were delegated through
a system shell. A timeout and a warning label do not provide tenant isolation,
credential isolation, filesystem confinement or rollback.

Avermate must expose typed domain tools by default. Any later execution tool
belongs behind the sandbox provider, a declared capability profile, bounded
resources and egress, an isolated workspace snapshot and the same approval
policy as every other high-risk operation.

### Tool and event contracts were duplicated

Streaming and non-streaming paths defined overlapping tools and serialized
results directly from runtime-specific implementations. That invites drift
between embedded chat, MCP and background jobs.

Avermate uses one typed tool registry and policy broker. UI, model and audit
projections may differ, but they are derived from the same invocation and
bounded result contract.

## Reference, not porting material

No Fichr chat code, database, prompt, credential, conversation or unrestricted
shell implementation is to be imported into Avermate. Reusing an upstream UI
dependency is a separate dependency and licence decision; this note grants no
permission beyond the upstream project's own licence.

The portable decisions are:

1. preserve search, model selection, copy, visible tool status and branch
   navigation as UX requirements;
2. preserve old messages when editing or retrying;
3. make the server-side message/event history authoritative;
4. require pre-execution policy decisions for side effects;
5. keep generic execution outside the account, academic and conversation
   services.

## Acceptance implications for the agent plans

- Plan 026 must prove a versioned event envelope and resumable runtime boundary
  without importing provider-framework types into durable tables.
- Plan 027 must provide one typed tool registry for embedded chat, MCP and jobs,
  including separate model, UI and audit result projections.
- Plan 029 must implement durable thread search, model selection, streaming,
  copy, edit/retry branches and compare-and-swap branch heads. Conversation
  export is a new requirement, not a Fichr carry-over.
- Plan 030 must make approval a persisted pre-execution state and record
  compensations or explicitly non-reversible outcomes.
- Plan 031 must be the only route to shell-like execution and must prove
  workspace, credential, resource and network isolation.

The POC is useful evidence that these interactions are understandable. It is
not evidence that their original implementation is safe or production-ready.
