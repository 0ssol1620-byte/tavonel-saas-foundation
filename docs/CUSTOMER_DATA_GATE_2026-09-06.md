# Customer-data gate and source ACL — current state, 2026-09-06

Campaign `TAVONEL-USKC-P0-20260906-V1`, lane F. Blueprint §3.2, §16, §24, §26 (절대 gate), §48 P0-F, §55.
Base commit `4c18e86`.

**This lane enables nothing.** `activationPolicy.customerData.enabled` is `false`, the live compile
request builder still writes `foundation_synthetic_only` as a literal, and several of the seventeen
preconditions below are MISSING — so no evidence set that exists today can produce an allowed
decision. What the lane adds is a boundary that can be *read*: an enumerated list with evidence per
row, a decision type, a durable record, and the ACL rule derived knowledge has to obey.

---

## 1. What was here before

One comparison, in `shared/productCoreCompileEnvelope.ts`:

```ts
if (input.route.privacyPolicy !== "foundation_synthetic_only") {
  return { accepted: false, code: "PRIVACY_POLICY_NOT_ALLOWED" };
}
```

`CompileJobEnvelope["route"]["privacyPolicy"]` has spelled `approved_customer_data` since the type
was written. Turning customer data on was therefore a one-line deletion that satisfies the compiler
and reads, in a diff, as tidying. That is the top risk the seam map named and it is the reason this
module exists: after this lane the same act requires supplying a decision object that names seventeen
preconditions, each with evidence and a timestamp, bound to a tenant and a workspace.

The second enforcement point is `buildProductCoreV2Request` in `nextjs/lib/core-runtime-v2.ts:166`,
which hard-codes `privacyPolicy: "foundation_synthetic_only"` and does not read it from its caller.
That literal is itself a fail-closed gate and it stays. `nextjs/lib/customer-data-live-path.test.ts`
asserts it, and asserts that the string `approved_customer_data` appears nowhere in that file.

---

## 2. The seventeen preconditions

Vocabulary frozen in `contract/enums.v1.json` (`CustomerDataPrecondition`), transliterated into
`shared/uskcEnums.ts`. Status is **EXISTS** (implemented and tested here), **PARTIAL** (something real
exists, with a named hole), or **MISSING** (no implementation in this repository).

| # | Precondition | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | `tenant_isolation_suite_passed` | PARTIAL | RLS policies exist across `supabase/migrations/0001`, `0003`, `0004`, `0043`, `0044`. `supabase/tests/tenant_rls_matrix.sql` is written and `server/foundation/rlsMatrixContract.test.ts` asserts it *covers* ten browser-readable relations — by reading the SQL as text. **No runner executes it.** No `pnpm` script invokes it; neither Docker nor the Supabase CLI is installed on the build machine. The isolation suite has never run against Postgres in this repository. |
| 2 | `encryption_at_rest_verified` | MISSING | Supabase and Cloudflare R2 encrypt at rest as platform properties. Nothing in this repository records a verification, and a platform's marketing page is not a receipt. Needs a stated verification method and a dated record. |
| 3 | `encryption_in_transit_verified` | PARTIAL | HSTS `max-age=31536000; includeSubDomains` at `nextjs/next.config.mjs:34`, pinned by `nextjs/lib/security-headers.test.ts`. `readProductCoreV2Env` (`nextjs/lib/core-runtime-v2.ts:128`) refuses a core URL that is not `https://`. No verification covering the R2, Supabase and RunPod legs end to end. |
| 4 | `connector_credentials_in_secret_manager` | EXISTS (with a caveat) | `nextjs/lib/connector-oauth-vault.ts` — AES-256-GCM envelopes, a 32-byte key and a broker token read from managed environment secrets; migration `0016_oauth_secret_vault.sql`; tests `connector-oauth-vault.test.ts`, `connector-oauth-vault-migration.test.ts`, `connector-oauth-secrets.test.ts`. Caveat to state rather than hide: this is application-level envelope encryption over Postgres plus platform environment secrets, not a dedicated KMS or HSM. |
| 5 | `no_secrets_in_receipts_or_logs_verified` | PARTIAL | Database-level guards reject secret-shaped keys in audit bodies: `0012_foundation_connections_and_api_keys.sql:134`, `0014_enterprise_control_plane.sql:118`, and the same guard in `0050`. No repository-wide check that application logs and compile receipts are secret-free. |
| 6 | `malware_scan_and_quarantine_active` | PARTIAL | Quarantine-first intake is live: `QUARANTINE_PREFIX` (`nextjs/lib/r2-presign.ts:5`), CDR enabled (`nextjs/lib/activation-policy.ts`), and `bindSanitizationProof` (`shared/documentProcessing.ts:46`) refuses a proof whose `outputMimeType` is not `application/pdf` or whose `sanitizerVersion` is blank. **CDR is disarm-and-reconstruct, not an antivirus verdict.** No AV engine appears anywhere in this repository. |
| 7 | `archive_bomb_limits_enforced` | EXISTS | `nextjs/lib/archive-expand.ts`: `MAX_FILES` 128, `MAX_EXPANDED_BYTES` 500 MiB, decompression ratio ceiling 100, plus traversal, encryption and nested-archive refusals. Tested in `nextjs/lib/archive-expand.test.ts`. |
| 8 | `compile_receipts_signed_and_audited` | MISSING | Ed25519 signing exists but only for the trust export (`nextjs/lib/export-signing.ts`, `app/api/export/trust/route.ts`). `CompileReceipt` is not signed, and no compile path writes an audit event: neither `nextjs/lib/compile-job-store.ts` nor `nextjs/lib/collection-compile-run.ts` references either audit table. |
| 9 | `deletion_tombstone_propagation_verified` | MISSING | `nextjs/lib/connector-oauth-adapters.ts:80` lists Google Drive with `q=trashed = false`, so a trashed file leaves the listing with **no** downstream signal, while the Dropbox and Microsoft Graph adapters emit `kind: "deleted"` (`:114`, `:154`). No tombstone table, no propagation test. Blueprint §15.2 names this as a stale-knowledge failure. **RESOLVED B-7: not an acceptable production limitation — connector qualification is `BLOCKED` until tombstone, delete, permission-change and move/rename semantics are implemented and verified; no connector is `VERIFIED` before then (P2).** |
| 10 | `retention_controls_configured` | PARTIAL | `enterprise_governance_policies` stores `retention_days`, `deleted_object_grace_days` and `audit_retention_days` (`0014:88-90`), applied through `apply_enterprise_governance_policy` and read by `nextjs/lib/enterprise-store.ts:122`. **Configuration only — no sweeper, no job, nothing deletes on schedule.** A retention sweeper that deletes wrongly is itself a stop-the-line event, so it needs a canary, not a checkbox. **Updated 2026-09-27 (§10): a guarded worker exists but is not scheduled or proven live.** |
| 11 | `data_export_and_delete_available` | MISSING | `/api/export/trust` exports a signed trust record and `/api/enterprise/audit/export` exports audit events. Neither exports customer sources. The only `DELETE` handlers in `nextjs/app/api/**` are for connections and developer API keys; customer-initiated source deletion is an "on request" process, not a self-service route. **Updated 2026-09-27 (§10): PARTIAL — source inventory and deletion paths exist, but physical erasure of derived artifacts and live proof do not.** |
| 12 | `audit_log_active` | PARTIAL | Two tables exist. `foundation_developer_audit_events` (`0012`) is written by `nextjs/lib/developer-store.ts:77` and `nextjs/lib/connector-oauth-store.ts:50`. `enterprise_audit_events` (`0014`) is written by `record_enterprise_audit_event` and read by `nextjs/lib/enterprise-store.ts:142`. Neither records a document read, a compile, or (before this lane) a gate decision. |
| 13 | `least_privilege_connector_scopes_verified` | PARTIAL | Scopes are declared in code and published rather than discovered at the consent screen: `nextjs/lib/connector-oauth.ts:42,48,54`, exported as `OAUTH_CONNECTOR_SCOPES`. Google is `drive.readonly`. **Microsoft asks for `Files.Read.All` and `Sites.Read.All`, which is tenant-wide read**, not least privilege for one workspace. |
| 14 | `per_provider_isolation_verified` | MISSING | Per-connection secret envelopes exist, but nothing tests that one provider's credential or content cannot reach another provider's code path. |
| 15 | `dpa_and_privacy_notice_published` | PARTIAL | `/privacy`, `/terms` and `/subprocessors` are published. No data processing agreement exists anywhere in the repository. `nextjs/app/subprocessors/page.tsx:13-19` lists Supabase, Vercel, Cloudflare, RunPod, Paddle and Google — **not Dropbox and not Microsoft**, although live connector code exists for both. RESOLVED A-5 settles that omission: source providers are not subprocessors, and neither is added until the production customer-data architecture delegates processing to them and legal review confirms. The DPA itself stays open until legal (RESOLVED B-10). |
| 16 | `per_source_acl_preserved` | MISSING | This lane defines `shared/aclSnapshot.ts` and `public.source_acl_snapshots`. No connector captures an ACL at ingestion, and no retrieval path filters by one — `nextjs/lib/retrieval-store.ts` and `nextjs/lib/retrieval-pipeline.ts` filter by tenant and workspace only. Storage is not enforcement. **Updated 2026-09-27 (§9): PARTIAL — default-deny serving enforcement exists; capture and viewer identity do not.** |
| 17 | `founder_approval_receipt_recorded` | MISSING by design | No receipt exists. Recording one is not an agent's act, in this campaign or any other. |

Two rows EXIST (4, 7), eight are PARTIAL (1, 3, 5, 6, 10, 12, 13, 15) and seven are MISSING
(2, 8, 9, 11, 14, 16, 17). Blueprint §48 P0-F's acceptance — "no customer
traffic enabled until the security suite passes" — has, before this lane, no suite to point at; §2 of
this document builds one, and §5 says exactly what it does and does not prove.

---

## 3. What the code does

### `shared/customerDataGate.ts`

`evaluateCustomerDataGate({ tenantId, workspaceId, evidence, now })` returns an allowed decision only
when every one of the seventeen has exactly one evidence row, `satisfied === true`, non-blank
evidence, and a `checkedAt` that is an ISO-8601 instant. (`Date.parse` alone was not enough: it
accepts `"2026"`, `"0"` and `"Sat Sep 6 2026"`, and a gate stamped with any of those is not auditable
to a moment, so the shape is pinned. The shape alone was not enough either: `Date.parse` range-checks
an ISO day against 31 rather than against its month, so `"2026-02-30T00:00:00Z"` is instant-shaped,
parses finite and silently means 2026-03-02 — the day must now spell itself back.) Anything else is
`{ allowed: false, missing: [...] }` naming the rows that failed. `receiptSha256` is sha256 over the
canonical JSON of the tenant, the workspace and the evidence list in frozen precondition order, so it
is a function of what was approved and not of the order the caller assembled it.

Deliberate fail-closed choices, each with a test:

- Two rows for one precondition are a disagreement, not a stronger claim → that precondition is missing.
- A blank tenant or workspace, or an unparseable `now`, refuses all seventeen rather than approving something unattributable.
- `gateAdmitsCustomerData` re-checks the schema version, the receipt digest shape, and that the tenant and workspace equal the envelope's. A decision for another tenant is not an approval.

**Known ceiling on the receipt digest, stated exactly.** `gateAdmitsCustomerData` checks that
`receiptSha256` *matches* `^sha256:[a-f0-9]{64}$`. It does not re-derive it, and it cannot: the
decision type frozen in contract §4.3 carries no evidence, so a hand-built
`{ allowed: true, …, receiptSha256: "sha256:" + "0".repeat(64) }` is admitted by shape. What that
costs is bounded — a caller able to fabricate a decision object in process can equally call
`evaluateCustomerDataGate` with fabricated evidence — and what closes it is not code in this file:
the durable record. `customer_data_gate_receipts` stores the `evidence` array beside
`receipt_sha256`, and `customerDataEvidenceReceiptSha256` is exported so a reader of a row re-derives
the digest instead of trusting it (`customerDataGateMigration.test.ts` exercises exactly that on a
row-shaped fixture).

The related hole is closed rather than stated: contract §4.3 originally fixed the digest as being
over the evidence list alone, which made a digest portable between tenants — the evidence rows are
paths, receipt digests and test ids, none of them tenant-specific, so two tenants with the same
evidence produced the same digest and one copied from an approved tenant re-derived true for an
unapproved one. §8.1 amends §4.3: the digest now covers `tenantId` and `workspaceId` together with
the preconditions, and re-deriving a stored row's digest therefore also proves the row was not
lifted from another tenant's approval. A row is still attributed by its `tenant_id` and
`workspace_id` columns as well.

`validateCompileJobEnvelope(input, gate?)` gained one optional parameter. Called without it — which
is every call site in this repository — the behaviour is byte-for-byte what it was:
`PRIVACY_POLICY_NOT_ALLOWED`. The pre-existing tests in
`server/foundation/productCoreCompileEnvelope.test.ts` were not touched and still pass. The
condition is an **allowlist**: `foundation_synthetic_only` passes, `approved_customer_data` passes
only behind a matching allowed gate, and every other value — an unknown policy, the empty string, a
value added to the union later — is refused whether or not a gate is present.

### `shared/aclSnapshot.ts`

`intersectAcl(snapshots)` implements "derived knowledge cannot be more permissive than every
governing source evidence": a principal survives only if it appears in every snapshot, at the least
permissive permission any of them granted. No snapshots yields no principals — an empty argument list
means "nobody", never "everybody", because a caller that forgot to pass its snapshots must not
thereby publish.

A grant whose `kind` or `permission` is outside the frozen vocabulary is dropped before any
comparison, so the principal is *absent* from that snapshot rather than unranked. Ranking it
`undefined` widened: `undefined < 2` is false, so `owner ∩ "admin"` kept `owner` and `"admin" ∩ read`
emitted `"admin"`. These values cross the type boundary at runtime — connector JSON, and the
`principals` jsonb column — so the same vocabulary is now also a check constraint in migration 0050;
a value the intersection cannot rank is one the table will not store.

**Known ceiling, stated rather than smoothed over:** containment between principal kinds (`anyone`
covers a `domain` covers a `group` covers a `user`) is not implemented. Expanding a group to its
members needs a directory lookup this repository does not have, and every containment rule can only
*widen* the result — so the strict identity intersection is the version that cannot leak while the
lookup is missing. The consequence: a source shared with `anyone` and a source shared with one named
user intersect to nobody. That pair needs a human decision, not a guess.

### `supabase/migrations/0050_customer_data_gate_acl.sql`

Two tables, no third audit table.

`customer_data_gate_receipts` records every evaluation, allowed or refused — a refusal is the only
record that shows the gate was ever actually closed. `allowed` defaults to `false` and two named check
constraints make `true` unwritable without `satisfied_count = 17`, a receipt digest and an empty
`missing`; `missing` is constrained to the seventeen frozen names. `source_acl_snapshots` holds
captured principal sets, unique on (source version, provider, digest) so a re-capture of an unchanged
ACL is the same fact.

Both tables have RLS enabled, are revoked from `public`/`anon`/`authenticated`, carry an explicit
restrictive default-deny policy in the style migration 0003 established for `billing_events`, and
grant `service_role` **select and insert only**. A recorded gate decision is history and history is
not rewritten.

**Audit table: `enterprise_audit_events` (migration 0014).** Gate decisions are recorded there with
action `customer_data.gate_evaluated`, target type `workspace`, `actor_kind = 'system'`, and outcome
`succeeded` or `denied`. Why that one rather than `foundation_developer_audit_events` (0012):

- 0014 has an `outcome` column that already includes `denied`. A refusal is the event that matters most here, and 0012 has nowhere to put one except a free-text `details` blob nobody can query.
- 0014's `action` is a regex, so a new action needs no `ALTER` of a live table; 0012's is a closed enum of six connector and API-key actions.
- 0014 already has governed retention (`audit_retention_days`), which is what precondition 12 needs.

The cost, stated rather than hidden: `enterprise_audit_events.organization_id` is `not null` and
references `enterprise_organizations`. A workspace with no organization row cannot record a gate
event, and therefore cannot be approved. That is the fail-closed direction, so it is left as is.

**Deferred foreign key.** `source_acl_snapshots.source_version_id` has no FK to `public.source_versions`
because that table arrives in migration 0049, on a sibling branch of the same campaign, and a
cross-branch FK is precisely the merge hazard the campaign's migration numbering was allocated to
avoid. Nothing writes either table yet, so the referential gap has no live consequence. After both
branches merge, one statement closes it:

```sql
alter table public.source_acl_snapshots
  add constraint source_acl_snapshots_source_version_fk
  foreign key (source_version_id) references public.source_versions (source_version_id) on delete restrict;
```

---

## 4. The activation policy row

`nextjs/lib/activation-policy.ts` — the *live* policy read by `/api/status`, `/api/uploads/capability`,
the OAuth sync route, `/security` and `/workspace` — gains one key:

```ts
customerData: { enabled: false, reason: "Customer-data processing is gated until the security suite passes and the founder records an approval receipt." },
```

`shared/activationPolicy.ts` is the legacy root-runtime copy and is untouched. The capability grid
(`nextjs/lib/capabilities.ts`) gains one row, `Customer-data compilation`, reported `Closed` with
that reason. Two consequences worth recording rather than discovering later:

- `readCapabilities` currently has **no page consumer**. Its only importers are `lib/compiler-contract.ts` (which reads one word out of it) and its own tests. The grid the module's doc comment describes as "the one table on the marketing page that makes factual assertions" is not rendered by any page in this build.
- `/security` and `/workspace` both render `Object.entries(activationPolicy)` through their own label maps, and both are updated: `app/security/page.tsx` gained the matching `CAPABILITY_LABELS` row, and `app/workspace/page.tsx` gained the `GATE_LABELS` row plus a heading that no longer counts the gates in words ("Four gates" → "Processing gates"). Contract §8.1 authorises F to close these two seams itself, which repair round 2 did; `GATE_LABELS` is now typed `Record<ActivationCapability, string>`, so the next policy key fails `tsc` instead of reaching the screen as camelCase.

---

## 5. The security suite

§48 P0-F's acceptance names an "explicit security suite". None existed: both CI workflows run
`check`/`test`/`build` as one undifferentiated pipeline. Two scripts now name one.

`pnpm security:suite` (repository root) runs
`rlsMatrixContract`, `tenantAuthorization`, `supabaseHardeningMigration`, `creditLedgerRlsMigration`,
`productCoreCompileEnvelope`, `customerDataGate`, `customerDataGateMigration`, `aclSnapshot`.

`pnpm --dir nextjs security:suite` runs
`security-headers`, `connector-oauth`, `connector-oauth-secrets`, `connector-oauth-vault`,
`connector-oauth-route`, `connector-contract`, `archive-expand`, `activation-policy`,
`customer-data-live-path`.

**A green suite is necessary and not sufficient.** What it proves is narrow and worth spelling out:

- It reads SQL as text. It does not execute a single policy against Postgres. `tenant_rls_matrix.sql` still has no runner (precondition 1).
- It covers the seven MISSING preconditions with nothing, because there is nothing to cover them with.
- It cannot observe the deployed platform: encryption at rest, TLS on the R2 and RunPod legs, and the actual scopes a consent screen granted are all outside it.

Green means the code in this repository behaves as its authors intended. Approving customer data
needs the seven MISSING rows implemented, the eight PARTIAL rows closed, an executed isolation suite,
and a founder receipt. Only the last of those is a decision; the rest is work.

---

## 6. Decisions already made — recorded, not asked

Every item below was written as a question in the first pass of this document and is closed now, by
`USKC_FOUNDER_DECISIONS_RESOLVED_2026-09-06.md` or by lane-contract §8.1 / §8.2. They are restated
here as the standing state of the gate, each with the item that closed it. Nothing in this section
is a question, and this lane re-opens none of it.

1. **Audit table, and the `organization_id` consequence.** RESOLVED B-6 makes `enterprise_audit_events` the canonical log for customer source/data security events; `foundation_developer_audit_events` keeps developer/API/configuration acts and there is no third table. Contract §8.2 rules the consequence recorded in §3 — `enterprise_audit_events.organization_id` is `not null`, so a workspace with no enterprise organization row cannot record a gate event and therefore cannot be approved — the intended fail-closed direction. It stays as built.
2. **`/subprocessors` stays as it is.** RESOLVED A-5: source providers are not TAVONEL subprocessors, and Dropbox and Microsoft are **not** added on the strength of connector code existing — only after the production customer-data architecture delegates processing to them and legal review confirms. Precondition 15's row records their absence as a fact about today's architecture, not as a disclosure defect, and the page is unedited.
3. **DPA — precondition 15 stays open until legal.** RESOLVED B-10 lists DPA and privacy disclosures among the prerequisites for allowlisted-beta enablement, and contract §8.2 records precondition 15 as open until legal. No DPA exists in this repository, so the row stays PARTIAL. Publishing one is a legal act.
4. **Microsoft Graph scopes → P2.** `Files.Read.All` + `Sites.Read.All` is tenant-wide read rather than least privilege for one workspace (precondition 13). Contract §8.2 assigns the narrowing to P2, alongside the rest of the connector work RESOLVED §D sequencing item 6 places there: `SourceConnector` contract, stable source ids, incremental sync, ACL capture, permission changes, tombstones, retention/deletion, connector qualification.
5. **Google Drive tombstones are a blocker, not an accepted limitation.** RESOLVED B-7: the `trashed = false` gap (`connector-oauth-adapters.ts:80`) is **not** an acceptable production limitation. P0 records it; connector qualification is `BLOCKED` until tombstone, delete, permission-change and move/rename identity semantics are implemented and verified, and until then no connector is `VERIFIED`. Precondition 9 stays MISSING.
6. **Retention enforcement → P2/P3, with its own approval.** Contract §8.2. Precondition 10 stays PARTIAL: the policy is stored, nothing enforces it. A sweeper is a delete path, so it ships with its own canary and its own approval — never as a checkbox on this matrix.
7. **`docs/SECURITY_BOUNDARIES.md` is appended, not struck.** Contract §8.1. The statements that went stale stay, and the dated "Current state" section stands beside them; historical text is not overwritten. Settled.
8. **Precondition 17 is recorded only by the founder — a fact, not a question.** Contract §8.2. No agent creates a founder approval receipt: a gate that can be closed by the thing it gates is not a gate. Row 17 is `MISSING by design` and stays so until the founder records one.
9. **The gate receipt digest binds its subject — done.** Contract §8.1 amended §4.3 so the digest covers `tenantId` and `workspaceId` together with the preconditions; repair round 2 implements it in `shared/customerDataGate.ts`, so a receipt is not portable between tenants.

---

## 7. Addendum 2026-09-27 — preconditions 8 and 12 in code

Rows 8 and 12 above are left as written; this records what changed since.

- **Signed compile receipts.** `nextjs/lib/compile-receipt-signing.ts` builds a `tavonel.compile_receipt.v1`
  payload from an allowlist of identifiers and digests (tenant, workspace, collection, manifest, Core
  request id and output digest, the gate receipt digest that admitted the compile, document/version
  ids, `compiledAt`) and signs it with the export Ed25519 key under its own protected-header scope,
  `tavonel.signed_compile_receipt.v1`. Only a trust-store (v2) signer is accepted. `verifyCompileReceipt`
  checks the signature over the exact stored bytes, then the shape, then that the tenant and workspace
  are the ones asked about. An export-scope signature does not verify as a compile receipt and vice versa.
- **Audited compiles.** `runCollectionCompile` refuses with `COMPILE_RECEIPT_SIGNER_NOT_CONFIGURED`
  before reading the gate, R2 or the Core when no signer exists, and after the Core answers it signs the
  receipt and appends `compile.receipt_signed` to `enterprise_audit_events` (via `appendServiceAuditEvent`,
  `actor_kind = 'service'`) **before** the candidate is written. An audit write failure returns the
  audit code and persists no collection candidate. The Core may already have run.

Still open, so neither row is claimed as satisfied: no production key, trust store or compile has
produced a receipt (the gate is closed, so no customer compile can run); receipts inherit the export
trust store's expiry, so a receipt stops verifying once its key's `expiresAt` passes; a failed or
refused compile writes no audit row; and document reads outside the compile path are still unaudited.

---

## 8. Update 2026-09-27 — rows 9 and 14 (appended; the table above is the 2026-09-06 state)

Code and mocked-provider tests only. No production,
provider account, or flag was touched, and `customerData.enabled` stays `false`.

**Row 9 → PARTIAL (code-complete for Google on the mocked contract; not VERIFIED).** The
`q = trashed = false` listing cited above is removed. `listOAuthSourcePage` now refuses
`google_drive` with `OAUTH_SOURCE_READER_RETIRED` before any network I/O. Google is read only
through the change feed in `nextjs/lib/google-drive-lifecycle.ts`. That reader takes its watermark
before the snapshot, replays changes, and emits `kind: "deleted"` for both trash and removal.
`sync-worker.ts` now fails a Google job that does not name `google-lifecycle-v2` (a legacy
`google-files-v1` or reader-less job) as `SOURCE_READER_PROVIDER_MISMATCH`. That happens before
any credential is read. Before this change, such a job fell through to the trashed-filtered
listing. The following are tested through the real reader in `sync-worker.test.ts`:
- Trash becomes a suspension plus a `provider_deleted` tombstone.
- Unshare or move-out becomes `provider_inaccessible`.
- A move or rename (a Drive `version` bump) re-imports under the same stable id.
- An interrupted tombstone write retries from the unadvanced change token and replays idempotently.

What is still open:
- Google sources imported by the retired reader before their connection's first lifecycle job,
  and then deleted before its watermark. No reconciliation diffs the snapshot against prior
  bindings.
- Deletions under a previously selected target after the target changes.
- An expired or invalid change token. It retries to dead, which fails closed, but there is no
  rebaseline.
- Per-user ACL capture for permission changes that do not remove the connected account's
  access (row 16).
- Live-account qualification. B-7 stands: no connector is `VERIFIED`.

**Row 14 → PARTIAL.** `nextjs/lib/connector-provider-isolation.test.ts` pins the following:
- Downloads, listings and version reads each go only to their own provider's origin, with that
  provider's bearer.
- A cursor from one provider is refused by every other provider's path without a request.
- One provider's OAuth configuration does not configure another.
- The binding trigger and the deletion RPC require `provider` to equal the connection's provider.

The worker takes the provider from the stored connection, never from the job payload, and
refuses a reader/provider mismatch before refreshing a token. This is not a live cross-account
test.

**Row 13, restated as a separate blocker.** Microsoft still requests `Files.Read.All` +
`Sites.Read.All` (tenant-wide read). Scopes were deliberately not changed here; narrowing them
remains P2.

---

## 9. Row 16 update, 2026-09-27 — enforcement without capture

Appended, not struck: §2 row 16 above keeps its
original text and carries a one-line pointer here.

**Status: PARTIAL.** The serving side is enforced and fails closed. The capture side and the viewer
identity it needs do not exist, and neither was faked.

### What exists

`supabase/migrations/20260927101000_source_acl_admission.sql`:

- `source_acl_snapshots` gains a `workspace_key` (NOT NULL, same pattern as every other workspace key).
- A `before insert` trigger (`guard_source_acl_snapshot`) refuses a snapshot unless a
  `connector_document_bindings` row exists for the same `source_version_id`, `workspace_key` **and**
  provider (`SOURCE_ACL_SNAPSHOT_UNBOUND`), and refuses one captured in the future
  (`SOURCE_ACL_SNAPSHOT_FUTURE`). A trigger and not a foreign key, because the founder test reset
  deletes bindings before snapshots.
- `source_version_acl_admits(workspace, source_version, provider, viewer_principals)` — service-role
  only. Admits only when the newest snapshot for that exact version, in that workspace, from that
  provider, captured within the last 24 hours, grants `read`/`write`/`owner` to one of the viewer's
  principals by exact `(kind, principalId)`. If several snapshots share the newest instant, all must
  admit. Missing, stale, superseded, cross-workspace, cross-provider or other-version snapshots admit
  nobody. No containment (`anyone`/`domain`/`group` do not cover a user) — the §3 ceiling, unchanged.
- `connector_documents_blocked` — the RPC behind `checkConnectorSourceAccess`, which already guards
  document source/candidates/progress/list, collection read/ask/download/promote, retrieval, compile
  and World reads — keeps every previous denial and adds
  `or not source_version_acl_admits(..., '[]'::jsonb)`.

Version binding follows from identity: a connector document id is derived from
(workspace, connection, native id, revision), and each binding maps it to exactly one
`source_version_id`, so a new provider revision is a new document that needs its own snapshot.

**Consequence: every connector-bound document is denied at serving.** Documents with no connector
binding (direct uploads) are not affected. Connector intake already requires a verified
customer-data gate decision, which requires this row, so no workspace loses access that the gate
ever granted.

Tests: `supabase/tests/source_acl_admission.sql` (pgTAP, 17 assertions — write-time binding, missing /
stale / superseded / cross-scope denial, overlay denial, privileges) and
`nextjs/lib/source-acl-admission-migration.test.ts` (text contract, including a tripwire that no
application module writes `source_acl_snapshots`). The 2026-09-27 integration check ran the five migration contract tests and the pgTAP fixture parser;
the pgTAP file runs in `.github/workflows/db-rehearsal.yml`.

### Blockers, exact

1. **No viewer has a verified provider principal.** A TAVONEL member is a Supabase auth user. The
   only provider identity on record is the account that authorised a connection
   (`fetchOAuthProviderIdentity`, per connection), not per viewer. Matching a member's email string
   to an ACL entry would be an unverified identity claim. Closing this needs each member to prove
   their provider identity (an OAuth sign-in per member per provider) and a store for that link;
   until then the overlay passes an empty principal set and nothing is admitted.
2. **Dropbox — cannot capture with granted scopes.** The connector asks for `account_info.read`,
   `files.metadata.read`, `files.content.read`. Reading file/folder members is a sharing API and
   needs `sharing.read`, which is not requested. Adding it is a consent-screen change.
3. **Google Drive — partial ACL only.** With `drive.readonly`, the file resource's `permissions`
   field is populated only when the caller can share the file and is not populated for shared-drive
   items (per Google's Drive v3 reference); group and domain grants cannot be expanded to members
   without Admin SDK Directory scopes, which are not requested.
4. **Microsoft Graph — partial ACL only.** Item permissions are listable under the existing
   `Files.Read.All`, but group grants cannot be expanded without a group-membership scope, and
   SharePoint inherited site permissions and organisation-scope sharing links do not map to named
   principals. The existing scopes are already flagged as over-broad (row 13).

Items 2–4 are from provider documentation, not from calls made in this change; no provider was
contacted. A partial ACL is safe in the deny direction (an under-listed grant only denies), so
Graph and Drive capture become worth building once item 1 exists — not before, since nothing could
evaluate them.

Not changed: `activationPolicy.customerData` stays `false`; no flag, secret, scope or deployment was
touched. The founder test reset deletes snapshots by `source_versions` membership, not by the new
`workspace_key`; a snapshot whose version is only in `connector_document_bindings` survives a reset
as an orphan that can admit nothing (the admission query starts from the binding).

---

## 10. Rows 10 and 11, 2026-09-27 — guarded source deletion prototype

Migration `20260927102000_customer_source_deletion.sql` extends the existing connector tombstone,
inventory attestation, and object-purge chain to uploaded sources. It adds customer-requested and
retention-expired reasons, requires owner/admin membership and workspace-bound admission, rechecks
legal hold under the deletion lock, and blocks re-upload with the same document ID after a tombstone.
An operator-only legal-hold table permits a self-service workspace without an enterprise governance
policy to distinguish a known inactive hold from an unknown state. Unknown or active holds still deny.

`/api/documents/[id]/lifecycle` exposes a workspace-scoped export inventory, an audited dry run,
and an execute request that must repeat the inventory digest. It returns an evolving deletion
receipt. A `source_objects_purged` receipt covers only the document's own attested R2 objects and
explicitly says derived artifacts remain. The route signs
the receipt with the export key when configured and reports an absent signer explicitly. The
attestation worker records per-item failures so one blocked tombstone does not silently complete
or halt the entire queue. Serving, compile, collection, retrieval-index, and Ask paths are denied
for a tombstoned source; deleted documents are omitted from the document list.

The retention worker is POST-only. A single-workspace execute requires the digest from dry run;
fleet execution additionally requires `FOUNDATION_RETENTION_FLEET_ARMED=true`. There is no cron
entry or production arm. Focused local Vitest checks passed 241 tests across seven files, and the
Next.js type/lint check passed. The migration and 53-assertion pgTAP file still need a successful
PostgreSQL rehearsal and a real synthetic canary through the complete deletion chain.

**Rows 10 and 11 remain PARTIAL.** Derived collection artifacts, retrieval units, and cached
answers are denied at serving but are not physically erased. A previously issued progress URL
can remain valid for its 120-second lifetime. Connector deletion in self-service workspaces still
lacks a grace-period source. Purge-stage failures lack a dedicated append-only failure record.
No production R2 deletion receipt exists. The 2026-09-27 local check passed 5,324 Vitest cases,
the type/lint check, and the Next.js production build after preserving ACL admission in the
later deletion migration; CI database rehearsal and a real canary remain outstanding.
An Opus 5.5 code review then identified three defects: enterprise assignment changes could bypass
the effective hold, the signed receipt overstated deletion scope, and rehearsal replay could restore
old connector-only inventory functions. The follow-up adds a hold-transition trigger, makes the
receipt say `source_objects_purged` with its limited scope, and removes superseded files from the
replay pass. The follow-up still needs CI PostgreSQL rehearsal and a synthetic R2 canary.
The second independent read found a workspace-key UPDATE route around the hold trigger; the key
is now immutable. It also found that replaying old migration 0053 would erase later service-role
grants, so that file is excluded from the replay pass. The signed receipt schema is v2.
The last review found two bounded issues: the lifecycle inventory route could expose connector
metadata without ACL admission, and retention execution could select a different document after
the reviewed candidate set changed. The route now checks source access before exposing a live
inventory, and the retention worker calls an exact candidate RPC carrying its workspace, document,
creation time, retention policy and grace period. A changed candidate fails closed.
The production R2 bucket's `immutable/` prefix remains under a 365-day object lock. The founder
test reset on 2026-09-23 hit `ObjectLockedByBucketPolicy`; it completed only after a temporary
scoped change, and the broad lock was restored (`docs/evidence/production/TAVONEL_FOUNDER_TEST_RESET_2026-09-23.md`).
The live Cloudflare bucket settings were read again at 2026-09-27 16:12 KST; the
`Immutable 365 day lock` rule on `immutable/` was still enabled.
Therefore the code's 30-day default grace is a scheduling value, not a verified 30-day physical
purge. Storage lock, retention promises, and legal holds must be reconciled before activation.
These gaps must be closed or explicitly bounded before
customer-data activation; this code does not change `activationPolicy.customerData`.

### 10.1 Purge-stage failure evidence, 2026-09-27 (local verification)

Migration `20260927103000_source_deletion_purge_failures.sql` closes the "purge-stage failures lack
a dedicated append-only failure record" gap locally. `source_deletion_worker_failures` now accepts
stage `purge`, bound by foreign key to one attested object. `record_source_deletion_purge_failure`
writes it only for the claim that made the attempt, under the same per-object lock as begin and
finalize. It never marks an object purged, releases a claim or writes a receipt. The deletion worker
(`/api/internal/deletions/run`, already on the Vercel cron) records every failure after a claim.
This covers HEAD, begin, DELETE, finalize and an invalid receipt. It returns `failureRecorded` so a
lost evidence write is visible. Legal-hold and short-lease refusals happen before any object I/O.
They are not recorded as purge failures.

R2's `ObjectLockedByBucketPolicy` refusal now maps to `SOURCE_DELETE_OBJECT_LOCKED` instead of
the generic `SOURCE_DELETE_FAILED`. The customer status reports each unpurged object's failure count
and last failure. The signed receipt is now schema v3 and has a new state,
`purge_blocked_by_storage_lock`, with `objectsRetainedUnderStorageLock`. An object that the bucket
lock refuses is therefore reported as retained, never as purging or purged.

Product decision taken, safest truthful path: no lock rule was changed, no retention claim was
shortened, and a locked object is never skipped or marked done. The worker retries it on each claim
rotation and records each refusal, until the lock lapses or an operator acts. Customer-facing copy
must not promise a 30-day physical purge for anything stored under `immutable/`. The
receipt now states the retention explicitly instead.

Checks: 73 focused Vitest tests, TypeScript, and ESLint passed locally. The pgTAP file
`supabase/tests/source_deletion_purge_failures.sql` has 19 assertions. The SQL migration and
fixture still require CI database rehearsal before this is relied on.

**Still open for rows 10 and 11:**

- physical erasure of derived artifacts (collections, retrieval units, cached answers);
- a grace-period source for self-service connector deletion;
- reconciling the 365-day `immutable/` lock with the 30-day grace, which needs a legal/product
  decision on the promised retention;
- CI PostgreSQL rehearsal of 20260927102000 and 20260927103000;
- a real synthetic R2 canary through tombstone → attest → purge, including one locked object.
