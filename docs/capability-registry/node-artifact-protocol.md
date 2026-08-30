# Node capability artifact bytes (v1)

Core capability references with `object.namespace = "files"` use an opaque `files.id`. They are not Node storage keys. The artifact broker resolves the owner-scoped file row, its actual storage provider/key, size, MIME and SHA-256 before reading bytes. Temporary capability writes use durable two-phase adoption keyed by owner, operation, name, purpose, MIME and digest; identical retries reuse one file ID. These writes preserve the selected storage placement, including Node-only storage. A selected but offline Node fails closed rather than falling back to Core storage.

Before inference, Core authorizes egress and stages exact bytes to the offering's paired Node in `capability-inputs`. Destinations and upload idempotency keys are deterministic. It rewrites every input reference, then computes the request digest and signs the grant over those staged references. Authorization runs again before inference. Node checks the signature, owner, offering/configuration, limits and input metadata.

## Private HTTP sidecar contract

Sidecar requests advertise `x-avermate-artifact-protocol: inline-base64-v1`. Requests without artifacts retain the existing `NodeCapabilityRequestV1` JSON body. Requests with artifacts use:

```json
{
  "artifactProtocol": "inline-base64-v1",
  "request": "<NodeCapabilityRequestV1 or NodeCapabilityJobManifestV1 object>",
  "artifacts": [
    { "artifact": "<exact granted CapabilityArtifactRef object>", "bytesBase64": "<canonical base64>" }
  ]
}
```

The angle-bracket values above denote objects, not literal strings. The Node daemon reads only the exact granted artifacts from its own storage. It verifies the stored metadata and actual digest before including bytes. No storage credential, URL or filesystem path is sent to the sidecar. Existing Node-local DNS pinning, redirect denial, deadlines and sidecar-local credentials still apply.

A result with no artifacts may remain a plain `NodeCapabilityResultV1`. Results with artifacts must return:

```json
{
  "artifactProtocol": "inline-base64-v1",
  "result": "<NodeCapabilityResultV1 object>",
  "artifacts": [
    { "artifact": "<exact outputArtifacts entry>", "bytesBase64": "<canonical base64>" }
  ]
}
```

Every output ref must appear exactly once in the inline bytes list. The sidecar must compute `outputDigest` over the canonical `{result, outputArtifacts}` payload using its original refs. Node validates owner, envelope binding, digest, size and canonical base64 before persisting any bytes, then rewrites refs into its operation-scoped `capability-outputs` namespace and recomputes `outputDigest`. Sidecars cannot choose a canonical Core file ID or a durable Node output key.

Inline artifacts are capped at 32 MiB per invocation; offering limits can be smaller. The HTTP envelope allows bounded base64 overhead with a 64 MiB hard wire cap. Streaming supports input artifacts but deliberately rejects output artifact refs: use a unary or artifact-job result to publish bytes.

## Reviewed worker bridge

Local OCR and transcription use the artifact-job lane. Core stages both the source and a strict `NodeArtifactWorkerRequestV1` JSON entry manifest. The legacy worker adapter grants exactly these resources to the existing reviewed handler. Worker output JSON is downloaded and checked against source digest, model identity/revision, no-network attestation and request bounds before Core normalizes pages or segments. Unsupported page filters, word timestamps, diarization and vocabulary options fail explicitly.

## Publication and recovery

Core accepts outputs only in `capability-outputs` or `artifact-worker-results`, with the SHA-256 operation prefix. It checks returned byte size/digest, supported MIME signatures, and exact normalized-result artifact authority. Authorization is rechecked before durable adoption through the Core artifact broker. Adoption uses the same placement-preserving writer as input artifacts: metadata is owned by Core, while canonical bytes remain on the owner's selected Node/local/S3 storage. Adopted output refs use `namespace=files` and the canonical file ID. Worker JSON is an internal transport artifact, not a published file.

Successful publication triggers best-effort deletion of only the exact owner/ref/digest inputs and outputs. Failed adoption retains verified Node outputs. Lost dispatch responses are marked ambiguous and non-retryable automatically; deterministic inputs remain available for explicit reconciliation/replay of the exact operation. Cleanup failures do not invalidate already adopted results. Orphaned generic-capability artifacts are not currently covered by the legacy job retention reaper; operator reconciliation may be needed after a crash or persistent cleanup failure. Node-selected input adoption is durably retryable through the same write call; the existing background adoption reconciler scans Core-managed providers only.

Fixture coverage includes nonempty filesystem-backed Node bytes through the real sidecar client/executor, worker-manifest/source reads, Core adoption/ref rewriting, digest/MIME rejection, consent fencing, deterministic replay, uncertain dispatch, cleanup failure, durable SQL adoption and local/Node placement preservation. These are deterministic fixtures, not evidence of a live external model run.
