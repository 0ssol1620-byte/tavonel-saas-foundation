# Scoped customer-data launch policy — decision and implementation contract

Date: 2026-09-29. Status: **adopted for implementation; no production activation**.
This changes the *target release policy*, not the current `tavonel.customer_data_gate.v1`
receipt or any production switch. The customer-data and live-charge switches remain closed
until the scope-specific checks below have evidence and the new code has passed qualification.

## Why the current policy must change

The v1 gate requires all 17 conditions for every workspace. Five conditions describe OAuth
connectors, although a direct upload uses no connector credential, provider change feed, provider
scope, provider isolation or provider ACL. The same exact-workspace receipt is checked at upload,
connector sync, compilation and checkout. `shared/customerDataGate.ts`,
`nextjs/lib/customer-data-gate-store.ts` and migrations `0050`/`0051` also fix the number 17 in
their validation. Calling connector conditions “satisfied because unused” would make the receipt
misleading. Deleting conditions from the shared list would open connector paths under an upload
approval. Neither is acceptable.

The per-workspace, 30-day technical attestation is also unsuitable for open signup: encryption,
malware processing and the deployed isolation suite are release facts, not different facts for
each new account. A workspace still needs its own authorization, terms acceptance and entitlement.
Those are separate records and must never be inferred from a deployment attestation.

## Two scopes, with separate receipts

| Scope | First customer use | Required v1 condition numbers | Additional runtime rule |
| --- | --- | --- | --- |
| `direct_upload` | PDF/Office/image upload through quarantine, CDR, OCR, compile and signed export | 1–3, 5–8, 10–12, 15, 17 | Reject connector-bound documents and all connector intake/sync. |
| `connector` | Cloud/file-server ingestion and derived reads | All 17 | Require provider identity, source ACL capture and serving enforcement, deletion/change semantics and live provider qualification. |

The five connector-only conditions are 4 (credential vault), 9 (tombstones), 13 (least-privilege
scopes), 14 (provider isolation) and 16 (source ACL capture). Direct uploads still require
workspace membership and tenant-scoped object authorization; excluding condition 16's *provider*
ACL does not remove those checks. A direct-upload approval must never authorize a connector API,
background sync or a compile containing a connector-bound document. The connector scope remains
closed while its provider and viewer-identity gaps remain.

## Records and enforcement required before changing a switch

1. Introduce a v2 scope-bound decision and immutable digest. The digest includes schema version,
   scope, release revision, subject and evidence. Keep the v1 reader fail closed during migration;
   production currently has zero v1 receipts. A later recorded refusal must revoke approval.
2. Record deployment-level technical and legal evidence once per release revision and scope,
   expiring on a defined schedule. Bind a separate operator release decision to that evidence
   and to the founder's standing delegation. Do not label an agent action as a personal founder
   signature or infer release authorization from a successful test or this document.
3. Record a separate workspace grant after identity, terms and applicable data-processing terms
   are accepted. Check both the release decision and exact-workspace grant at intake, before
   external Core dispatch, before serving derived data, and at checkout. A missing or stale record
   denies. New signup must not require manually copying 12 release receipts into every workspace.
4. Make connector entry points demand `connector` scope before metadata or bytes are accepted.
   Classify every selected compile document from durable source bindings; a mixed collection
   demands connector scope. Never accept a caller-supplied source kind as that classification.
5. Separate account creation from permission to upload or purchase. A free account may inspect
   public examples without a customer-data grant; every CTA must state the available action.
   Do not charge for a plan that cannot process the buyer's files.
6. On a gate refusal or expiry, stop new upload/compile and reconcile outstanding checkout
   intents and subscriptions. Prove immediate pause/cancel or another no-new-charge path,
   provider reconciliation and customer notice before subscription checkout opens.

## Conditions that cannot be removed by relabeling

For `direct_upload`, release evidence still has to establish tenant isolation on the deployed
schema, encryption and transport boundaries, secret-free receipts/logs, active malware scan and
quarantine, archive limits, a production signing key and audited compile, retention, customer
source export/deletion, audit logging, and truthful privacy/DPA terms. The DPA served today is
explicitly a draft pending counsel review. Its final contractual terms and the lawful customer
processing basis are legal work, not an environment flag. The exact data-processing agreement
flow for self-service must be settled before real customer uploads.

The customer documents in `D:\#센서 고객사 제공 자료` provide a useful local real-file corpus: 71
readable PDFs (1,136 pages), one DOCX, two unsupported DWGs and one `Thumbs.db`; 64 distinct file
hashes. No file was uploaded in this review. Corpus availability proves neither permission to
process it through external providers nor an upload → CDR → OCR → compile → export result.

## Qualification and rollout order

1. Ship the v2 schema and guards **with all production flags unchanged**. Test that an upload
   receipt fails every connector route, a connector-bound compile, cross-workspace reads, stale
   evidence, duplicate evidence and later refusals. Run the database policy tests against a real
   Postgres instance, not only migration text.
2. Close the direct-upload implementation gaps: customer source export and deletion, retention
   execution, self-service organization/audit linkage, secret-log checks and live signer proof.
   Verify CDR/ClamAV and OCR through their production endpoints using an approved test corpus.
3. Complete DPA review and the release/workspace terms flow. Test a new account and a small
   allowlisted direct-upload cohort with a real file, signed export and AI consumer. Record
   source hash, processing and cost receipts, deletion/rollback and operator ownership without
   publishing customer content.
4. Qualify live billing with a real checkout, signed webhook, entitlement, renewal/revocation,
   cancellation and refund path. Only then enable paid self-service for that bounded cohort.
   Expand to open signup after monitoring and support ownership are demonstrated.
5. Qualify connectors independently; do not market or enable them from the upload cohort's
   evidence. Activate only the providers whose identity, ACL, tombstone and scope checks pass.

Rollback is not only setting `customerData.enabled=false`: stop new intake and charges, pause or
cancel affected subscriptions, preserve access to export/deletion, and retain auditable receipts.
The v5 masterplan's full Model Arena/router program remains a separate product milestone; it is
not evidence that a narrow paid direct-upload workflow works, nor a reason to sell an unqualified
connector. Public copy must describe the exact scope actually active.

## Current state

The v2 scope-bound evaluator and negative unit cases are implemented in
`shared/scopedCustomerDataGate.ts`. The additive v2 release and workspace decision ledgers and
read-side verifier are present, but they are inactive: no production v2 rows, authenticated
terms-acceptance writer, route enforcement, deployment attestation or production qualification
exists yet. A code-generated `allowed` value is evidence to verify, never permission by itself.
The v1 reader remains the only production guard and continues to refuse every workspace without
a current receipt.
The Cloudflare R2 bucket settings were read on 2026-09-29: `immutable/` has an enabled 365-day
Bucket Lock rule and `quarantine/` has an enabled 365-day lifecycle deletion rule. Neither
supports a 30-day physical-purge claim. The guarded deletion PR #121 remains a draft until the
retention contract and locked-object canary are resolved.
This document does **not** authorize live customer upload, live charges or a claim that the
conditions above passed. The current v1 gate and production flags remain the enforcement source
until a separately reviewed implementation replaces them.
