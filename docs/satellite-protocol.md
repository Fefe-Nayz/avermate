# Avermate satellite protocol

> **Superseded design sketch.** This storage-only v1 predates conversation
> placement, inference, durable event replay and the paired-node threat model.
> The replacement is defined in
> [`avermate-node-protocol.md`](avermate-node-protocol.md). Do not implement a
> new satellite or infer the v2 wire contract from this document; it is retained
> only as historical input.

This is the design contract for a future user-run satellite. No satellite
implementation ships in the current phase.

## Purpose

A satellite lets a student keep costly storage or inference on hardware they
control while continuing to use the hosted Avermate interface. The Avermate
server is the only caller. **The browser never contacts the satellite.**

## Discovery and versioning

Every route is under `/v1`. `GET /v1/health` returns:

```json
{
  "protocolVersion": 1,
  "instanceId": "opaque-id",
  "capabilities": ["storage"]
}
```

Unknown major versions are rejected. Additive response fields within v1 are
ignored by older clients.

## Authentication and pairing

1. The satellite displays a short-lived, single-use pairing code.
2. The student enters the satellite HTTPS URL and code in Avermate settings.
3. The main server exchanges the code for a random bearer token, verifies
   `/v1/health`, and stores the token sealed server-side.
4. Subsequent requests carry `Authorization: Bearer <token>` from the main
   server only. Tokens can be revoked and rotated from either side.

No browser, MCP client or mobile bundle receives the token. Pairing rejects
redirects to a different origin and private-network targets unless the
self-hosting operator explicitly enables that network path.

## Storage capability

The v1 storage surface follows a small S3-like contract:

- `PUT /v1/storage/objects/{key}` stores the request body and returns its byte
  size, MIME type and digest.
- `GET /v1/storage/objects/{key}` streams the object with its MIME type and
  digest headers.
- `HEAD /v1/storage/objects/{key}` returns metadata without content.
- `DELETE /v1/storage/objects/{key}` is idempotent.

Keys are opaque server-generated identifiers, never user paths. Requests have
declared and enforced byte limits. A digest mismatch fails the write.
`files.provider = "satellite"` and `files.storageKey` are the Avermate-side
integration seam.

## Reserved inference capability

`/v1/inference/*` is reserved for a later OpenAI-compatible adapter. Capability
discovery must name the supported models and limits; absence of the capability
is normal. The main server still applies its ownership, rate and approval
policies before forwarding a request.

## Failure semantics

- Timeouts and an unreachable satellite produce a clear capability-specific
  banner; the academic core remains available.
- Writes use idempotency keys so a retry cannot duplicate an object.
- Avermate never silently falls back from satellite storage to an operator-paid
  provider.
- Health failures do not delete configuration. The student can retry, rotate
  credentials or disconnect explicitly.

## Registration experience

Settings asks for the satellite URL and pairing code, performs discovery, then
shows the capabilities and last successful health check. Disconnecting first
lists any Avermate files still assigned to the satellite and requires an
explicit migration or deletion decision.

## Open questions for the build plan

- TLS and tunnelling for home networks without a public certificate;
- upload/download bandwidth and resumable objects;
- backup, restore and object-integrity scanning;
- quota reporting and garbage collection;
- recovery when the satellite token is lost.
