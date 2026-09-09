# Connector lifecycle candidate

Status: implemented candidate; Google reader is not selected by the production worker.

The current worker treats non-file events as unsupported imports. A removal event can therefore be skipped while the job advances its cursor and reports success. The candidate worker stops with `SOURCE_LIFECYCLE_REVIEW_REQUIRED` before importing a remaining page containing removals. It does not advance that checkpoint. This is an explicit operator failure, not revocation of an existing source or World.

The Google Drive reader takes a change watermark before enumeration and returns a separate zero-item checkpoint. Its caller must persist that checkpoint before fetching the first snapshot page. It replays changes from the original watermark after enumeration, retaining the final change token for subsequent polling. Metadata version identifies rename changes. Removals distinguish observed trash from deletion-or-loss-of-access ambiguity. Missing, malformed, incomplete, or stalled provider responses are refused.

Legacy cursors are not converted or reset automatically. Shared-drive lifecycle events are refused for review. Existing imported data is not retroactively assigned a guessed native identity.

The import path now emits a stable logical source ID scoped by workspace, connection, provider and native ID, plus a revision-specific source version ID. Names and paths do not participate. Existing valid quarantine document IDs remain byte-for-byte compatible. Missing or control-character-bearing native IDs/revisions fail before downloading; they cannot create ambiguous delimiter-based replay identities.

Migration `20260909193323_connector_document_bindings.sql` and the binding store persist this identity, document ID, observed byte digest, length and MIME before intake admission. Replay reads and compares the stored winner; a different digest under the same provider revision refuses. The database assigns the original recorded timestamp. Its trigger verifies an active same-workspace/provider connection and locks it during insertion. Bindings cannot be updated or deleted and have no anonymous/authenticated access grants. A binding records an observation, not successful quarantine/CDR/compilation.

Deployment order: rehearse and apply the additive migration before deploying the import change. A missing table fails closed as CONNECTOR_BINDING_WRITE_FAILED. This candidate migration has only been applied to a disposable local PostgreSQL fixture; production is unchanged. The full repository migration chain is still a CI gate. Binding persistence is not retrieval authorization or removal propagation.

The existing source-domain store cannot simply be called with these identities: its quarantine key check assumes sourceId equals documentId, and its exact insert replay compares observation timestamps. Connector integration must introduce an explicit immutable document binding and stable observation replay semantics rather than weakening workspace key validation or overwriting timestamps. This remains a required implementation step.

## Remaining integration gates

Candidate addition: `connector_source_suspensions` stores an immutable denial for a bound source. The sync worker records known removal events before keeping the job in review; unknown/unbound events remain unresolved. The retrieval pipeline checks bound source suspension and connection status before external reranking and again before returning context. This is a negative authorization overlay, not complete per-user ACL evaluation: unbound legacy imports, group membership, provider permission capture, fallback Ask, downloads/exports and revocation of already issued packages remain separate work. No automatic unsuspension is implemented.

Both connector migrations must precede the app deployment. Missing authorization RPC fails retrieval closed. Actual production migrations remain unapplied. Local PostgreSQL tests cover active allowance, suspended denial, connection-revoked denial, tenant scope, browser denial and immutable suspension; mocked pipeline tests prove no reranker call for denied sources and no context return after mid-rerank denial. Full migration-chain CI is still required.

Signed collection download now checks package source manifest IDs against the RAG document inventory, refusing missing, duplicate or mismatched inventories. The direct route and its v1 wrapper check source access before signing and again after lease cleanup and account revalidation, before constructing the ZIP response. Unit route tests deny both early and late source revocation without ZIP bytes. This does not retract a package already downloaded. Fallback Ask and cached answer replays still need equivalent source checks.

Subsequent implementation: Ask now validates active source inventory before new/fallback/cached answers and checks suspension before cache completion and after lease cleanup. Authenticated World loading, raw collection JSON and new PDF read-capability issuance also check source denial. Public deterministic buildWorldReadModel samples remain pure and do not call private authorization. Already-issued PDF capabilities still live for up to 120 seconds; strict immediate revocation requires a separately authorized streaming path. Existing downloadable packages cannot be recalled. Full per-user ACL and legacy import qualification remain open.

DB repair replay: full-chain run34397664300 passed both initial application and repair replay after 0053 was updated to restore SELECT/INSERT for the two known connector tables when they exist. This CI receipt covers commit0ff99ab, not later application changes.

PDF candidate update: source metadata now names an authenticated same-origin API route, not an R2 bearer capability. The `format=pdf` path bounds the R2 read to32 MiB, verifies its immutable SHA256, then rechecks user, product and source access before streaming any bytes. The Studio sends its bearer token only in the API request header and passes received bytes directly to PDF.js; no capability or token is placed in a URL. Existing pre-deployment capabilities expire on their original schedule; already-received bytes cannot be recalled. Final viewer/browser, large-file platform streaming and cost/concurrency qualification remain required before promotion. Streaming follows Vercel's response-size guidance: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions

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
