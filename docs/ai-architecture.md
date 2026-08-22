# AI access architecture

This document records how Avermate exposes its study workspace to AI systems.
It is a product and security decision, not a description of one particular
model provider.

## Decision

1. **Avermate is MCP-first.** The current product does not embed a chat agent.
   OAuth-scoped MCP tools, resources and prompts let students use the agent of
   their choice without making inference hosting a requirement of the core app.
2. **An embedded agent remains an explicit later decision.** We revisit it when
   mobile-first students without an MCP client become a demonstrated audience,
   when the server already pays for an inference feature, or when the document
   editor needs an inline copilot that an external client cannot provide.
3. **Typed tools are verbs; MCP prompts are workflows.** Tools create, read,
   update or build domain objects. Resources carry study context. Prompts ship
   the methodology for workflows such as building a revision sheet. “Skills”
   are client-side packages and are not a server protocol surface.
4. **Paid integrations are optional capabilities.** Provider credentials are
   resolved on the server. Instance-level environment keys remain a supported
   default; the sustainability policy extends this with sealed per-user BYOK.
   Credentials never enter MCP results or browser payloads.

## Context

The study-companion roadmap turns Avermate into an AI-legible workspace:
course sources arrive as files, links, pasted text and recordings; students
produce revision sheets, mind maps and slides; external agents may browse and
author those objects. The design question is therefore where the agent lives,
which protocol owns its capabilities, and who authorizes and pays for the work.

The existing MCP endpoint already has OAuth scopes, deterministic catalogues,
server-side ownership checks and multi-round confirmation for destructive
actions. Reusing that boundary gives every compatible client the same
authoritative domain API and keeps the free application independent from one
model vendor.

## Consequences

- OCR, transcription and future inference use server-side provider adapters.
  Each adapter has an explicit disable switch and resolves a sealed user key
  before the instance-level environment fallback.
- Document authoring is exposed through revision-fenced tools. Methodology is
  delivered as prompts, not copied into private chat endpoints.
- No chat tables, streaming chat transport or model-specific conversation UI
  ship merely to make the study domains usable by agents.
- No private “AI API” may bypass oRPC ownership, validation or role checks.
- The same MCP surface remains usable by a future embedded agent if a revisit
  trigger fires.

## Embedded-agent readiness specification

### Conversation model, if it is introduced

Messages must support branching from their first schema version. They carry:

- `parentMessageId` and `branchIndex` for the server-side tree;
- `clientMessageId` and `parentClientMessageId` for optimistic reconciliation;
- structured `toolCalls`, never an opaque concatenated command log.

Conversations are user-owned and year-scoped like the rest of the academic
workspace. Branch identity is immutable; editing a prior turn creates a new
branch rather than rewriting history. This shape was validated by the earlier
Fichr prototype and avoids retrofitting branch semantics after users already
have histories.

### Approval and execution rule

Every AI-triggered mutation is authorized in one of two ways:

1. the user granted the corresponding OAuth scope and the authoritative oRPC
   procedure accepts the operation; or
2. the server enforces the existing multi-round confirmation protocol for a
   destructive action.

A client-side `approved: true` flag is not authorization. An
`execute_command`-style tool, a model-selected shell string, or any equivalent
general execution primitive is banned. If an operation cannot be expressed as
a typed, validated domain verb, the tool does not exist.

## Revisit triggers

Review this decision when any one of these becomes true:

1. mobile-first users without a capable MCP client become a demonstrated
   audience;
2. Avermate accepts server-side inference cost for another shipped feature,
   such as transcript summaries or automatic titles;
3. the revision-sheet editor needs an inline copilot experience that external
   MCP clients cannot provide.

Revisiting does not replace MCP. A future embedded agent consumes the same
tools, prompts, resources, authorization boundaries and provider-key policy.
