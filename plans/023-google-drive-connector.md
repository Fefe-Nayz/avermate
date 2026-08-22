# Plan 023: Google Drive, as a second personal drive

> The interface for this is already built. `DriveSyncSection` in
> `apps/web/src/app/(app)/settings/integrations/drive-sync-section.tsx` is
> parameterised by a provider descriptor, and adding Drive is one entry in
> `DRIVE_PROVIDERS` — _once the server can answer for it_. This plan is only the
> server delta.

## Status

- **Execution**: DONE (2026-08-21)
- **Priority**: P3 — after OneDrive has been used in anger
- **Depends on**: plan 020 §7 (OneDrive), which built `content_connections`
- **Written at**: 2026-08-21, branch `rewrite`

## Why it is a small plan

OneDrive and Google Drive are the same shape, and that is not a convenient
approximation — it is the reason they share a component:

|                    | OneDrive                         | Google Drive                       |
| ------------------ | -------------------------------- | ---------------------------------- |
| Auth               | OAuth (Microsoft identity)       | OAuth (Google)                     |
| Scope              | folders you point at             | folders you point at               |
| Change detection   | `deltaLink` + Graph subscription | `startPageToken` + `changes.watch` |
| Direction          | read-only                        | read-only                          |
| Knows about school | no                               | no                                 |

Moodle, by contrast, knows your courses, brings grades and a timetable as well
as files, and is configured with a token you paste — which is why it keeps its
own section and its own table.

## Server delta

```ts
// db/schema/sync.ts
export type ContentConnectionProvider = "moodle" | "onedrive" | "googledrive";
```

Nothing else in `content_connections` changes. The columns that carry
provider-specific state are already opaque:

- `cursor` — Graph's `deltaLink` for OneDrive, Drive's `startPageToken` here.
- `subscriptionId` / `subscriptionExpiresAt` — a Graph subscription there, a
  Drive `channel` here. Drive channels expire too (max ~24h for `changes.watch`),
  so the renewal job that OneDrive already needs is the same job.
- `scopeJson: { folderIds: string[] }` — Drive folder ids are opaque strings.

```ts
// routers/connectors.ts
oauthUrl: provider: z.enum(["moodle", "onedrive", "googledrive"]);
```

and the three provider-guarded branches (`browse`, `setScope`, `syncNow`,
`disconnect`) widen from `!== "onedrive"` to a set.

```ts
// lib/googledrive.ts — mirroring lib/onedrive.ts
createGoogleDriveAuthorization()
browseGoogleDrive(connection, remoteFolderId?)
normalizeGoogleDriveFolderScope(connection, folderIds)   // the antichain collapse
googleDriveConfigured()
deleteGoogleDriveSubscription(connection)
```

```
POST /api/webhooks/google-drive   → channel validation + enqueue a delta job
```

## The three real differences

1. **Google Docs are not files.** A `application/vnd.google-apps.document` has
   no bytes to download; it must be _exported_ to a chosen MIME type
   (`files.export`). Recommended mapping: Docs → `.docx`, Sheets → `.xlsx`,
   Slides → `.pptx`. Those are exactly the three formats the Office renderer
   already opens, so an exported Doc lands in Supports as something readable
   rather than as a row you cannot open. A Doc that is exported gets
   `origin: "googledrive"` and no edit affordance — writing back is out of scope
   and the read-only rule is what keeps it safe.

2. **Shared drives and "Shared with me".** Two extra roots that OneDrive does
   not have. `browse` should return them as pseudo-folders at the top level
   (`sharedWithMe`, and one per shared drive) so the picker can walk into them.
   The client needs no change: it drills into whatever `browse` returns.

3. **Scopes.** `drive.readonly` is enough and is what should be requested. It is
   a Google "restricted" scope, which means an app verification review before
   anyone but the developer can use it in production — worth knowing before
   promising a date. `drive.file` avoids the review but only ever sees files the
   user picked through Google's own picker, which is a different feature.

## Client delta

One line:

```ts
const DRIVE_PROVIDERS: DriveProvider[] = [
  { id: "onedrive", name: "OneDrive", rootLabel: "OneDrive" },
  { id: "googledrive", name: "Google Drive", rootLabel: "Mon Drive" },
];
```

and removing the `as "onedrive"` cast in the connect call once the enum widens.

**Done when**: a Google Drive folder syncs into Supports, a Google Doc inside it
opens in the reader as a document rather than as an unopenable row, and the
browser cannot tell which drive a row came from except by its chip.
