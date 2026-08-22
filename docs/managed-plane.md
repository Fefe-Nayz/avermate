# Optional managed plane: shadow accounting and invite beta contract

The repository contains the provider-neutral foundations for an optional
Avermate-operated storage, inference and execution placement. This is a
technical shadow implementation, not a paid product announcement. Checkout,
the billing portal, charging and managed production dispatch are disabled.

Plan 039 adds a guarded invite beta control plane and complete Web visibility;
it does not change that commercial default. Admission binds an HMAC-digested,
one-time invite to optional email, cohort, region, capability eligibility and
exact terms/privacy revisions. The immutable account record stores explicit
managed data-category consent. Revocation immediately blocks new managed
dispatch and cancels queued reservations, while Core, export/delete, BYOK, Node
and self-host stay available.

The academic core, MCP, BYOK, user-owned Avermate Node and full self-host modes
do not depend on this plane. A billing customer identifier never authorizes a
capability; only a versioned entitlement decision can do that.

## Runtime modes

| Setting                                               | Meaning                                                                                                                                                                                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MANAGED_ACCOUNTING_MODE=shadow`                      | Persist the entitlement decision, reservation and final usage, but record a would-block instead of denying ordinary quota decisions. Emergency disable still fails closed.                                                        |
| `MANAGED_ACCOUNTING_MODE=enforce`                     | Enforce the published entitlement and concurrency limits. This is implemented for tests and controlled deployments; it is not a launch claim.                                                                                     |
| `MANAGED_ADAPTERS_ENABLED=false`                      | Default. Operator-paid provider keys and managed placements cannot be selected in hosted production.                                                                                                                              |
| `AVERMATE_DEPLOYMENT_MODE=full-self-host`             | Create the local/self-host entitlement policy without contacting Avermate billing or telemetry. Instance-owned provider keys remain an operator choice.                                                                           |
| `MANAGED_REGION=<region>`                             | Filter the immutable model-policy catalogue by residency. It does not move existing data.                                                                                                                                         |
| `MANAGED_BETA_ENFORCEMENT_ENABLED=false`              | Default. Invitation, consent, cohort/capability eligibility and daily/monthly quota policies cannot silently activate operator-funded dispatch. A reviewed beta flips this only with exact capability/provider breakers in place. |
| `MANAGED_TERMS_REVISION` / `MANAGED_PRIVACY_REVISION` | Exact revisions required at invitation redemption. A mismatch fails closed and requires a newly reviewed action.                                                                                                                  |

`/ready` performs only database/schema/mode checks. It never calls a model,
storage provider, sandbox or billing endpoint.

## Accounting invariant

Every costly managed operation follows one sequence:

1. resolve the selected placement and immutable capability manifest;
2. check global/account/capability/provider circuit breakers;
3. reserve an exact integer maximum against a versioned entitlement;
4. dispatch only that exact, still-current routing decision;
5. consume authoritative provider usage where available and release the exact
   remainder;
6. leave ambiguous post-dispatch failures reserved until reconciliation, or
   conservatively consume the documented maximum when the provider path cannot
   report a final value.

Reservation, provider callback and webhook idempotency keys are durable.
Quantities are decimal strings backed by integer arithmetic. Adjustments append
compensating events with actor, reason and evidence; historical rows are never
rewritten. Cached model input is a separate capability. Pricing snapshots are
separate immutable data: the shadow API reports provider cost or operator
estimate, included quota and final/estimated status, while `userChargeMinor`
remains `null`.

The costly paths currently covered are OCR pages, media/document transcription
seconds, TTS characters, managed model input/output/cached tokens, embeddings,
sandbox resources and managed storage bytes. There is no active managed video
renderer path; `video.outputSeconds` remains unavailable instead of bypassing
metering.

## Placement and privacy

Managed storage wraps Plan 032's `ObjectStorageProvider`. Logical keys are
resolved under an account-scoped HMAC namespace; physical references do not
contain user input. Reservation precedes upload, adoption reconciles the
object-before-DB crash window, and replacement/deletion settle exact committed
bytes. Range and multipart behavior is inherited from the same provider
contract. Cross-account stat/read/range/list/delete attempts fail without
revealing existence.

Each model policy publishes provider, model, revision, modalities, context,
region, retention, zero-retention and training-opt-in requirements. Only the
latest enabled revision eligible for the user's region/consent is listed. A
model ID mapping to multiple providers is rejected as ambiguous. BYOK secrets
stay in the sealed server-side key store and are validated with a minimal
provider request; normalized errors never include the key or provider body.

Export, recoverable trash and delete-now are distinct operations. Delete-now
tombstones the core transactionally, then records one state per placement.
Managed deletion requires a reconciled receipt. An offline node remains
`pending_remote_deletion`; reconnect completion requires a signed,
nonce/manifest-bound receipt. An unreachable or revoked node is never described
as physically erased.

## Observability and operator boundary

Operational telemetry accepts low-cardinality metadata only and passes every
attribute through the redaction boundary. Prompts, document bodies, URLs,
credentials, signed grants and raw provider payloads are not operational
attributes. The self-host default exporter is a no-op. Security-sensitive
entitlement, secret, support, circuit-breaker, adjustment and deletion actions
append immutable audit events.

The protected managed API exposes mode, account usage/reservations and the
user emergency stop. Admin procedures publish typed entitlement, pricing and
model-policy revisions, reconcile expired reservations, append adjustments,
inspect non-content operational state and operate audited circuit breakers.
There is deliberately no checkout or portal route.

The user Web surface is Settings → AI & managed storage. It shows current
placement mode, region/processors, explicit consent categories, authoritative
normalized usage and limits, provider/breaker degradation, lifecycle receipts,
managed metadata export and staged deletion. The plan comparison states that
academic Core, data ownership, export/delete, BYOK, Node and self-host are not
paid features. Deletion truthfully stays `pending_remote_deletion` until a
verified placement receipt arrives.

The role-gated operator surface is `/admin/managed`. It exposes invite/cohort
state, managed-only account suspension, revisioned quota policies, breakers,
reservation reconciliation, redacted incidents, non-content correlation,
backup/restore freshness and evidence-bound launch gates. It has no support
content viewer. `managed_operational_evidence.source` distinguishes repository
fixtures, deployed drills, external attestations and operator observations;
repository fixtures cannot pass a gate.

The billing contract includes a signed, bounded deterministic test-mode adapter
whose only navigation targets use the reserved `.invalid` domain. Billing
webhook/subscription rows and immutable external-price mappings remain
observations. They never grant an entitlement. There is no production checkout
route or activation environment variable in this beta.

## Verification and current release blockers

Run `bun run verify:034`. Its aggregate executes every sub-gate and reports all
failures instead of stopping after the first one. The load gate exercises 30
days, 100 tenants, 10,000 runs and 1,000 simultaneous SQL reservations. The
restore gate prints non-sensitive RPO/RTO/digest evidence. Storage, sandbox and
air-gap proofs inherit Plans 031–033 without replacing or weakening them.

The managed plane must remain disabled for public production until every gate
is green and the repository licence, privacy/data-processing/retention/AUP and
terms, provider subprocessors, published cost language, security review,
on-call ownership, alerts and public incident/status path are complete. A
Docker/unit-test success is not evidence that those organizational launch
requirements exist.

As of the checked-in shadow implementation, local/node/managed storage and a
disposable Garage 2.3 conformance run are proven. The inherited packet/proxy/DNS
air-gap harness exists and fails closed, but its latest local run could not
produce evidence because Docker Desktop's content store returned HTTP 500 and
timed out before the Avermate stack started. `verify:032:selfhost-airgap` and
therefore `verify:034:selfhost-airgap` remain blocked until the same harness is
rerun on a healthy host. Compose configuration and absent environment variables
are not accepted as proof.

Likewise, the checked-in sandbox provider defaults to `disabled` and its
fail-closed behavior is tested, but unavailable profiles are not managed
isolation evidence. `verify:034:isolation` therefore exits non-zero unless a
real, attested provider is configured and passes the inherited conformance
matrix; the test-only mock is rejected. The restore runner exercises a clean
logical database/object-manifest fixture and labels its timing as repository
fixture evidence. Real provider backups, object versions, key recovery and
deployment RPO/RTO still require an environment-specific drill before launch.

The same is true for Plan 039: the checked-in control-plane and Web tests prove
repository behavior, not production isolation, processor terms, on-call
staffing, alert delivery, load, backup/restore or billing-provider readiness.
Those states must remain visibly blocked until exact deployed evidence is
attached and reviewed. `checkoutEnabled`, `billingEnabled` and `launchReady`
remain `false` regardless of fixture or operator gate state.
