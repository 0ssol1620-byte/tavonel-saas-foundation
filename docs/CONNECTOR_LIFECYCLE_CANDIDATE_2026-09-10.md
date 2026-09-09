# Connector lifecycle candidate

Status: implemented candidate; Google reader is not selected by the production worker.

The current worker treats non-file events as unsupported imports. A removal event can therefore be skipped while the job advances its cursor and reports success. The candidate worker stops with `SOURCE_LIFECYCLE_REVIEW_REQUIRED` before importing a remaining page containing removals. It does not advance that checkpoint. This is an explicit operator failure, not revocation of an existing source or World.

The Google Drive reader takes a change watermark before enumeration and returns a separate zero-item checkpoint. Its caller must persist that checkpoint before fetching the first snapshot page. It replays changes from the original watermark after enumeration, retaining the final change token for subsequent polling. Metadata version identifies rename changes. Removals distinguish observed trash from deletion-or-loss-of-access ambiguity. Missing, malformed, incomplete, or stalled provider responses are refused.

Legacy cursors are not converted or reset automatically. Shared-drive lifecycle events are refused for review. Existing imported data is not retroactively assigned a guessed native identity.

The import path now emits a stable logical source ID scoped by workspace, connection, provider and native ID, plus a revision-specific source version ID. Names and paths do not participate. Existing valid quarantine document IDs remain byte-for-byte compatible. Missing or control-character-bearing native IDs/revisions fail before downloading; they cannot create ambiguous delimiter-based replay identities. These IDs are returned to the worker but are not yet persisted or used for authorization.

The existing source-domain store cannot simply be called with these identities: its quarantine key check assumes sourceId equals documentId, and its exact insert replay compares observation timestamps. Connector integration must introduce an explicit immutable document binding and stable observation replay semantics rather than weakening workspace key validation or overwriting timestamps. This remains a required implementation step.

## Remaining integration gates

1. Persist workspace + connection + provider + native ID bindings and revision observations; support Dropbox path aliases without conflating distinct files.
2. Apply tombstones and permission shrink to all relevant imported versions and retrieval/export authorization before advancing the provider checkpoint.
3. Bind source updates to affected Worlds and expose stale/review states; never leave a removed source usable because the sync stopped.
4. Persist checkpoints across jobs, reconcile legacy inventories, and exercise retry/crash/concurrent-worker behavior against the real database.
5. Qualify create, update, rename, move, delete, permission shrink, revoke, reconnect, and expired-cursor recovery using actual test accounts. Keep Beta and the customer-data gate until these checks pass.

Validation: 85 focused tests passed, including 20 Google reader tests and 20 worker tests. Typecheck and lint passed. These mocks prove control flow and parsing, not live provider qualification or production ACL enforcement.

Primary contracts:
- https://developers.google.com/workspace/drive/api/guides/manage-changes
- https://developers.google.com/workspace/drive/api/reference/rest/v3/changes
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files
