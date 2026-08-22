# Plan 035 live evidence contract v2

`bun run verify:035` proves repository behavior. `bun run verify:035:live`
separately proves real-provider, browser, quality, load and redaction behavior.
It fails closed when the exact clean checkout, deployment digests or external
evidence bundle are absent. Repository fixtures cannot satisfy this gate.

Run from the exact clean release checkout:

```sh
PLAN035_LIVE_CONFIRM=strict-real-providers \
EXPECTED_AGENT_RELEASE_REVISION=<exact-HEAD> \
EXPECTED_AGENT_CONFIG_DIGEST=sha256:<64-hex> \
EXPECTED_AGENT_ENVIRONMENT_DIGEST=sha256:<64-hex> \
PLAN035_LIVE_EVIDENCE=/outside/checkout/plan-035/manifest.json \
bun run verify:035:live
```

The bundle contract is `schemaVersion: 2`, manifest type
`avermate.plan-035.live-evidence` and policy `plan-035-live-v2`. It binds the
release revision and checkout tree digest to a redacted configuration artifact
and exact environment digest. The bundle must live outside the checkout.
Relative artifact paths may not escape it.

Every evidence record is `schemaVersion: 1`, repeats all four bindings, names a
run and attestor, has bounded observation/expiry timestamps, and points to a
digest-matched JSON artifact of type `avermate.live-evidence-result`. The
artifact must repeat the record fields and measurements exactly. Opaque files,
anonymous assertions, stale evidence and a bare `thresholdsPassed: true` are
rejected.

Required evidence kinds:

| Kind                            | Required result                                                                                                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `direct-byok-provider-contract` | Pinned provider/model/prompt, positive scenarios and passed normalized contract                                                                                                                                                                                       |
| `paired-node-model-contract`    | Pinned Node/model/prompt, positive scenarios, reconnect and contract pass                                                                                                                                                                                             |
| `annotated-quality`             | Reviewed dataset/model/prompt; at least 40 answerable + 20 unanswerable questions and two model configurations; faithfulness, citation precision and claim coverage ≥ 0.95; locator and proof membership = 1; abstention recall ≥ 0.90; zero secret/cross-owner leaks |
| `web-chromium-production-flow`  | Real provider, edit/retry, reconnect, cancellation and zero accessibility violations                                                                                                                                                                                  |
| `load-isolation-100-runs`       | At least 100 concurrent runs across two owners; zero cross-owner, duplicate-dispatch and credential leaks                                                                                                                                                             |
| `security-redaction`            | Positive hostile matrix; zero secret, owner, raw-reasoning and signed-URL leaks                                                                                                                                                                                       |

Use the checked-in manifest/result templates as a shape guide only. Templates
are marked `templateOnly: true` and can never pass the gate.
