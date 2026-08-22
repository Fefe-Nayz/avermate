# Sustainability and hosting model

Avermate is intended to remain a useful, self-hostable study workspace even
when no paid integration is configured. This document records how features
with real marginal costs fit that promise.

## Decisions

1. **The core stays free.** Grades, subjects, analytics, goals, agenda,
   materials metadata, authored documents, social features and MCP access are
   core capabilities. They are not reserved for a paid plan.
2. **Metered AI capabilities are BYOK-first.** OCR, transcription and future
   inference resolve a sealed user key before an optional instance-level key.
   An operator may disable or quota its fallback; doing so must not degrade the
   rest of the application.
3. **Storage is instance-backed within a quota.** A future quota protects the
   hosted instance. Larger libraries can use a self-hosted satellite or an
   optional paid allowance without gating access to their metadata.
4. **A satellite is the open alternative to premium infrastructure.** It is a
   small user-run service for storage and, later, inference. The protocol is
   specified in [satellite-protocol.md](satellite-protocol.md); building the
   service is a separate phase.
5. **A paid tier comes last.** It may cover metered storage or provider costs
   only after BYOK and quotas exist. It must not gate the free core or MCP.
6. **Full self-hosting is supported.** An operator can run the complete stack
   and supply every optional provider key. See
   [self-hosting.md](self-hosting.md).

## Capability funding matrix

| Capability | Hosted default | Open alternative |
| --- | --- | --- |
| Academic core, agenda, documents, social, MCP | Free core | Full self-host |
| OCR | User BYOK, then optional operator fallback | Self-host with own key |
| Transcription | User BYOK, then optional operator fallback | Self-host with own key |
| File storage | Instance quota | Satellite storage or full self-host |
| Future model inference | BYOK or explicitly funded instance service | Satellite/local inference |
| Embedded agent | Governed by `ai-architecture.md` revisit triggers | Any external MCP client |

Provider keys are encrypted server-side and are never returned after entry.
Browsers do not call paid providers directly. A provider authentication error
invalidates that credential without exposing it in logs or responses.

## Open-source prerequisite

The repository still needs an explicit licence decision before any public
“open source” claim. AGPL-3.0 protects hosted-service reciprocity; MIT maximizes
reuse. The maintainer must choose and add the licence before public release.
Until then, source availability does not grant redistribution rights.

## Change rule

Any new feature with marginal provider, compute or storage cost must add a row
to the matrix and describe its free/self-hosted path before it is enabled on a
hosted instance. Billing is an implementation detail, not the architecture.
