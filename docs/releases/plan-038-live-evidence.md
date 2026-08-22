# Plan 038 live evidence contract

`bun run verify:038` proves repository behavior. It is not deployed proof.
`bun run verify:038:live` is the separate, fail-closed release gate. No live
evidence is checked into this repository.

Run the live gate from a clean checkout at the exact candidate revision. Put the
manifest, the redacted deployed configuration and all result artifacts in one
operator-controlled directory outside the checkout:

```sh
PLAN038_LIVE_CONFIRM=strict-real-services \
EXPECTED_NODE_RELEASE_REVISION=<exact-40-or-64-character-revision> \
EXPECTED_NODE_CONFIG_DIGEST=sha256:<redacted-deployed-config-digest> \
EXPECTED_NODE_ENVIRONMENT_DIGEST=sha256:<deployed-environment-digest> \
PLAN038_LIVE_EVIDENCE=/outside/checkout/plan-038/manifest.json \
PLAN038_NODE_HEALTH_URL=<url> \
PLAN038_CORE_HEALTH_URL=<url> \
PLAN038_LITELLM_HEALTH_URL=<url> \
PLAN038_QDRANT_HEALTH_URL=<url> \
PLAN038_TEI_HEALTH_URL=<url> \
PLAN038_QWEN3_HEALTH_URL=<url> \
bun run verify:038:live
```

The gate computes a SHA-256 over the exact Git tree listing, verifies that the
checkout is clean, and binds every result to that digest, the exact release
revision, the expected deployed environment digest and the expected redacted
configuration digest. It recomputes both configuration and result artifact
digests. Paths must be relative children of the external evidence bundle.

Start from
[`plan-038-live-manifest.v2.template.json`](./templates/plan-038-live-manifest.v2.template.json)
and
[`plan-038-live-result.v1.template.json`](./templates/plan-038-live-result.v1.template.json).
The checked-in files are deliberately invalid: copy them outside the checkout,
replace every placeholder, remove `templateOnly`, and add one current result per
kind. The result JSON is the digest-bound machine output of the drill, not an
operator-written summary. Its linkage fields and `measurements` must exactly
match the manifest record.
Observations older than 31 days and validity windows longer than 31 days are
rejected; expiry is part of the digest-bound result artifact.

Policy `plan-038-live-v3` additionally binds the local speech-to-text drill to
the exact `selfhost/whisper-large-v3-turbo-q5_0` model, its immutable deployed
revision, the `speech-to-text` sandbox profile and the digest-pinned worker
image. Put the exact revision and image digest in both manifest expectations and
the `full-self-host-flow` measurements. A different value on either side, a
missing segment timestamp or any cloud transcription fallback fails closed.
The result template is the complete `full-self-host-flow` example; duplicate
and replace the record with each other kind's typed measurements from the
contract.

## Required scenario and measurement profiles

All `scenarioIds` named by
`scripts/verification/plan-038-live-contract.ts` are mandatory; additional
scenarios may be recorded. `scenarioCount` must be at least the mandatory list
length. The important enforced measurements are:

| Kind                                     | Enforced result                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pairing-relay-revocation`               | at least 100 ordered and equally acknowledged frames; at least two replay attempts; zero accepted replay, order violation or duplicate effect; ack resume and gap detection; pairing mismatch/expiry/rotation/revocation scenarios                                                                                                      |
| `full-self-host-flow`                    | every auth, academic, file, OCR/RAG, local STT, chat, approved mutation and sandbox-artifact scenario passes; at least one locally transcribed audio and segment, every segment timestamped; exact manifest-bound Whisper model revision, `speech-to-text` profile and image digest; zero cloud/managed fallback; pinned release images |
| `storage-adoption-deletion`              | all four adoption/deletion crash windows and durable reconciliation; zero orphan, duplicate adoption or undeleted object                                                                                                                                                                                                                |
| `conversation-retrieval-model-placement` | at least three placement routes; offline fails closed; zero cross-owner leak, unauthorized fallback or usage drift                                                                                                                                                                                                                      |
| `embedding-rerank-placement`             | Gemini cloud plus Node-local embeddings, cloud plus Node-local rerank and offline behavior; at least four adapters; zero leak/fallback; parity delta at most `0.05`                                                                                                                                                                     |
| `corpus-placement-migration`             | Core→Node→Node→Core transitions with at least one document; exact body/locator parity; AAD tamper rejection, legacy sealing and candidate reauthorization                                                                                                                                                                               |
| `sandbox-isolation`                      | real attested runtime, all five escape classes, at least five attempts; zero escape, cross-tenant leak, secret leak or host privilege escalation                                                                                                                                                                                        |
| `runtime-checkpoint`                     | logical and native restore, incompatible/expired fallback, zero state mismatch and zero claim that a provider checkpoint is portable truth                                                                                                                                                                                              |
| `opencode-worker`, `openhands-worker`    | a successful bounded artifact plus at least five hostile cases each; zero boundary violation, outside-workspace artifact, unauthorized network success or cross-tenant leak; cancellation/deadline passes                                                                                                                               |
| `configurator-redaction`                 | real browser apply succeeds; zero secret in HTML, network, logs or redacted export                                                                                                                                                                                                                                                      |
| `hosted-web-node-lifecycle`              | Chromium pairing, fingerprint confirmation, placement/migration, offline state and revocation across at least two viewports; receipts present and zero accessibility or secret leak                                                                                                                                                     |
| `backup-restore`                         | non-empty seeded DB/object inventory, identical data and identity SHA-256 before/after, empty-target restore, tamper/non-empty rejection and zero network attempt                                                                                                                                                                       |
| `upgrade-n-minus-one`                    | distinct N−1/current versions, populated data digest preserved, verified backup/recovery and at least two injected failures with zero unrecoverable failure                                                                                                                                                                             |
| `airgap`                                 | offline bundle and full-self-host flow under a network monitor for at least 60 seconds; `networkAttempts=0`, `externalDnsQueries=0`, `registryPulls=0`                                                                                                                                                                                  |

A record with only `status: "passed"`, a boolean `thresholdsPassed`, stringified
numbers, missing scenarios or a value outside these thresholds is rejected.
Health endpoints are checked only after the complete evidence bundle passes and
never replace a drill.
