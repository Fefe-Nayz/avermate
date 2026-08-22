# Plan 037 live evidence contract v2

`bun run verify:037` proves deterministic repository behavior.
`bun run verify:037:live` separately proves the real copy-analysis and complete
learning loop. It cannot pass with a fixture provider, source-code assertion or
repository-local evidence bundle.

Run from the exact clean release checkout:

```sh
PLAN037_LIVE_CONFIRM=strict-real-learning-flow \
EXPECTED_LEARNING_RELEASE_REVISION=<exact-HEAD> \
EXPECTED_LEARNING_CONFIG_DIGEST=sha256:<64-hex> \
EXPECTED_LEARNING_ENVIRONMENT_DIGEST=sha256:<64-hex> \
PLAN037_LIVE_EVIDENCE=/outside/checkout/plan-037/manifest.json \
bun run verify:037:live
```

The manifest is `schemaVersion: 2`, type
`avermate.plan-037.live-evidence`, policy `plan-037-live-v2`, and binds the
release/checkout, redacted configuration artifact and deployed environment by
SHA-256. Every typed result artifact repeats those bindings and the complete
record exactly. Paths are bundle-relative, size/age/validity are bounded, and
the bundle must be outside the checkout.

Required evidence kinds:

| Kind                           | Required result                                                                                                                                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copy-analysis-provider`       | Pinned provider/model/prompt, positive copies/pages, exact locators and zero cross-owner leaks                                                                                                                                                                        |
| `labelled-learning-evaluation` | Policy `learning-evaluation-v1`, reviewed dataset and algorithm; ≥30 samples; region recall ≥0.90, score precision ≥0.95, score recall ≥0.90, objective top-k ≥0.90, taxonomy accuracy ≥0.85, unsupported-score rate ≤0.02 and zero unsupported-diagnosis regressions |
| `copy-to-mastery-web`          | Chromium journey over at least two viewports: upload, diagnosis confirmation, plan apply, quiz completion and evidence update; zero accessibility violations                                                                                                          |
| `provider-grade-integrity`     | Positive scenarios, zero provider-grade mutations and successful local overlay                                                                                                                                                                                        |
| `node-export-delete-retention` | Positive scenarios and deletion receipts, export/offline retry pass, zero orphaned personal records                                                                                                                                                                   |

A bare boolean quality assertion is deliberately insufficient. Use the
checked-in manifest/result templates only as shape guides; their
`templateOnly: true` marker makes them invalid evidence.
