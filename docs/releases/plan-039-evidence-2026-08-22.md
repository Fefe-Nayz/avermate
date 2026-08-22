# Plan 039 repository evidence — 2026-08-22

This record distinguishes checked-in beta behavior from external operational
proof. It is not a production launch approval.

## Repository evidence

- invite tokens are HMAC-digested, returned once, optionally account-email
  bound, revision-bound, expiring and protected from replay;
- beta account eligibility, explicit data-category consent, capability policy,
  daily/monthly quota and concurrency checks fail closed when enforcement is
  selected;
- managed metadata export and deletion request remain available independently
  from billing; deletion is reported pending until a verified remote receipt;
- operational evidence is redacted and source-labelled; repository fixtures
  cannot pass a launch gate;
- signed test-mode billing callbacks are bounded and tamper checked; checkout
  and portal fixture URLs use `billing-test.invalid` and cannot move money;
- user and operator Web routes cover enrollment, status, authoritative usage,
  providers, consent, privacy/export/delete, cohorts, quotas, breakers,
  reconciliation, incidents, evidence, backup/restore status, correlation and
  billing test-mode visibility;
- server values `checkoutEnabled`, `billingEnabled` and `launchReady` remain
  hard-coded `false` and there is no production activation route.

Run `bun run verify:039` to reproduce the repository checks.

## External gates still blocked

- no exact deployed managed storage/model/retrieval/rerank provider conformance
  report is attached;
- no live strong-isolation sandbox cross-tenant report is attached;
- no measured shadow observation window or production-provider cost
  reconciliation is attached;
- no deployed alert exercise, 30-day representative load run, privacy review or
  child/student processor decision is attached;
- no encrypted deployed backup and empty-environment restore drill with measured
  RPO/RTO is attached;
- no billing-provider/legal/tax/refund/price decision or provider test account
  evidence is attached;
- Docker Desktop remained unavailable for inherited air-gap evidence in the
  Plan 034 baseline.

Until those independent gates pass and a maintainer explicitly authorizes the
selected Phase D accounts/prices, the correct release state is an optional free
invite beta with checkout off. A repository fixture, static configuration or
operator-entered note is not a substitute for external evidence.

## Versioned external launch evidence

`verify:039:launch` must run from a clean checkout at
`EXPECTED_MANAGED_RELEASE_REVISION`. Deployed evidence stays in an
operator-controlled bundle outside that checkout. Start from the deliberately
invalid
[`plan-039-launch-manifest.v2.template.json`](./templates/plan-039-launch-manifest.v2.template.json)
and
[`plan-039-launch-result.v1.template.json`](./templates/plan-039-launch-result.v1.template.json),
then replace all placeholders and remove `templateOnly` in the external copy.

```sh
EXPECTED_MANAGED_RELEASE_REVISION=<exact-release-revision> \
EXPECTED_MANAGED_CONFIG_DIGEST=sha256:<redacted-deployed-config-digest> \
EXPECTED_MANAGED_ENVIRONMENT_DIGEST=sha256:<deployed-environment-digest> \
EXPECTED_MANAGED_AIRGAP=not-applicable \
MANAGED_039_LAUNCH_EVIDENCE=/outside/checkout/plan-039/manifest.json \
bun run verify:039:launch
```

`EXPECTED_MANAGED_AIRGAP` is an explicit trusted expectation: use `required`
when the candidate claims air-gap parity and `not-applicable` when it does not.
The manifest cannot waive the record by changing its own flag.

The v2 gate computes the candidate Git-tree SHA-256 and binds every result to
that checkout, the exact revision, the expected deployed environment and the
SHA-256 of a redacted deployed configuration artifact. It recomputes the config
and result artifact digests. The result artifact is typed machine output whose
linkage and measurements must exactly equal the manifest record; a standalone
`status: "passed"` assertion is rejected.
The result also binds its expiry. Observations older than 31 days and validity
windows longer than 31 days are rejected.

| Kind                    | Enforced result                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`              | real storage/model/retrieval-rerank/sandbox adapters; timeout, retry and cancellation; zero unreconciled operation, usage drift or cost drift                                                                              |
| `isolation`             | attested strong isolation, at least two tenants and five hostile attempts across storage/vector/conversation/sandbox/model; `crossTenantLeaks=0`, zero unauthorized success and zero secret leak                           |
| `backup`                | encrypted consistent recovery point with non-empty DB/object inventories, key inventory, immutable digests and tamper detection                                                                                            |
| `restore`               | empty-target deployed restore, identical before/after digest, provider reconciliation, tamper/non-empty rejection; measured RPO ≤ 86,400 seconds and RTO ≤ 14,400 seconds                                                  |
| `load`                  | at least 30 simulated days, 1,000 operations and two concurrent users; queue p95 ≤ 30 seconds, SSE first-event p95 ≤ 5 seconds; zero balance/grant/charge/oversubscription/leak/reconciliation drift                       |
| `privacy`               | every hostile/privacy scenario, DPIA-equivalent approval and child-data processor review; zero critical/high finding, content telemetry leak, secret leak or support-role bypass                                           |
| `alert`                 | all eight incident exercises; every expected alert delivered and deduplicated; maximum detection 300 seconds and acknowledgement 900 seconds                                                                               |
| `billing-test`          | signature, replay, out-of-order, quarantine, checkout/grace/cancel/portal and reconciliation in provider test mode; zero duplicate effect, entitlement regression or reconciliation drift; production checkout remains off |
| `web-customer-operator` | Chromium customer and role-isolated operator journeys across at least two viewports; consent/usage/export/delete/breaker states, zero accessibility/content leak, and production checkout remains off                      |
| `airgap`                | required only when the trusted expected profile says so; at least 60 monitored seconds and exactly zero external network attempt, DNS query or registry pull                                                               |

Every kind also requires the exact `scenarioIds` versioned in
`scripts/verification/plan-039-launch-contract.ts`, a named run and attestor,
current observation/expiry times, and an artifact within the external evidence
bundle. Stringified numbers, generic booleans or out-of-threshold measurements
do not close a gate.
