# File upload and storage transport

Avermate uses one storage boundary with two drivers:

- `local` is the zero-configuration development default. Objects are written
  below `apps/server/.data/uploads` (or `LOCAL_UPLOAD_DIR`) and read through the
  authenticated API.
- `s3` targets the self-hosted Garage S3 API in production. The browser uses
  `better-upload` to PUT directly to a short-lived signed URL, so a 50 MiB
  course PDF never has to be buffered by the API process.

The web client asks `/api/upload/status` which driver is active. Local uploads
use `/api/upload/local`; S3 uploads use `/api/upload`. Both return an opaque
`fileId`. Domain mutations adopt that identifier only after checking ownership,
purpose, recorded size and the actual object with `stat`/S3 `HeadObject`.

The Expo client and server-side imports keep the authenticated server upload
path. They still write to the same local/Garage backend and produce the same
`files` ledger rows; there is no second provider contract.

## Limits and privacy

The server is authoritative for MIME and byte limits. Course materials are
limited to 50 MiB each, 60 uploads per account and hour, and 5 GiB of stored
course material per account. The web batch limit of ten is only an interaction
guard.

Only avatars are public through the stable `/api/files/:id` route. Course
materials, lecture audio, feedback screenshots, grade copies and generated
exports require their owner (or the appropriate feedback administrator). S3
reads use short-lived signed URLs after that check. Garage buckets themselves
remain private.

An S3 reservation is inserted before the browser PUT. Failed or abandoned PUTs
therefore remain visible in the `files` ledger and the hourly storage reaper can
delete them after its 24-hour grace period. A domain failure after upload also
performs immediate compensating deletion where safe.

## Generated previews and LaTeX builds

PDF and image course materials enqueue a `materials.preview` job after upload,
provider synchronization and link-to-PDF ingestion. The worker renders a
bounded 512 px WebP and stores it as a separate private `files` row. A daily
repair scan catches uploads whose queue acknowledgement was interrupted. Live
preview and LaTeX-build references are ownership edges for the storage reaper;
purging their source schedules durable cleanup if the provider is unavailable.

LaTeX documents build explicitly through a bounded Tectonic worker. The
runtime needs `tectonic`, `pdfinfo`, `pdftoppm` and ImageMagick; their command
paths can be overridden with `TECTONIC_BIN`, `PDFINFO_BIN`, `PDFTOPPM_BIN` and
`MAGICK_BIN`. The production API image installs them. Tectonic supplies the
XeTeX-compatible (`xelatex`) path; `pdflatex` and `lualatex` metadata are
retained but fail explicitly until a separately sandboxed engine is added.

Packages declared with `\usepackage` or `\RequirePackage` need no separate
application setting: Tectonic resolves files from its controlled TeX bundle on
demand and reuses its cache. `TECTONIC_BUNDLE` can pin an operator-approved
bundle, `TECTONIC_CACHE_DIR` selects the persistent cache, and
`TECTONIC_ONLY_CACHED=true` makes builds strictly offline after that cache has
been pre-warmed. The worker records declared package names for diagnostics but
never runs `tlmgr`, shell escape or an arbitrary user-supplied installer.
Single-source documents cannot yet attach a private `.sty`; add such a file to
the pinned bundle when it must be available instance-wide.

Generated build work/storage is bounded independently from source materials:
120 build requests per account and hour, at most 512 MiB of live LaTeX PDFs
per account, and only the three newest PDF artifacts per document. Build rows
and bounded compiler logs stay as revision history after an older PDF is
reclaimed.

## Garage

The reference Compose deployment pins Garage 2.3, persists metadata, snapshots
and object data in separate volumes, bootstraps one private `avermate` bucket,
and applies the CORS policy needed by browser PUTs. `S3_BUCKET` and
`S3_PRIVATE_BUCKET` intentionally point to the same private bucket; object-key
prefixes retain the public/private classification while all reads stay behind
the application authorization boundary.

The bundled single-node layout has no redundancy. A serious production
deployment should follow Garage's multi-node guide, use at least three nodes
and a replication factor of three, and back up both Garage metadata and data.
