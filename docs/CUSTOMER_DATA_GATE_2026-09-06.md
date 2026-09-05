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
| 9 | `deletion_tombstone_propagation_verified` | MISSING | `nextjs/lib/connector-oauth-adapters.ts:79` lists Google Drive with `q=trashed = false`, so a trashed file leaves the listing with **no** downstream signal, while the Dropbox and Microsoft Graph adapters emit `kind: "deleted"` (`:114`, `:154`). No tombstone table, no propagation test. Blueprint §15.2 names this as a stale-knowledge failure. |
| 10 | `retention_controls_configured` | PARTIAL | `enterprise_governance_policies` stores `retention_days`, `deleted_object_grace_days` and `audit_retention_days` (`0014:88-90`), applied through `apply_enterprise_governance_policy` and read by `nextjs/lib/enterprise-store.ts:122`. **Configuration only — no sweeper, no job, nothing deletes on schedule.** A retention sweeper that deletes wrongly is itself a stop-the-line event, so it needs a canary, not a checkbox. |
| 11 | `data_export_and_delete_available` | MISSING | `/api/export/trust` exports a signed trust record and `/api/enterprise/audit/export` exports audit events. Neither exports customer sources. The only `DELETE` handlers in `nextjs/app/api/**` are for connections and developer API keys; customer-initiated source deletion is an "on request" process, not a self-service route. |
| 12 | `audit_log_active` | PARTIAL | Two tables exist. `foundation_developer_audit_events` (`0012`) is written by `nextjs/lib/developer-store.ts:77` and `nextjs/lib/connector-oauth-store.ts:50`. `enterprise_audit_events` (`0014`) is written by `record_enterprise_audit_event` and read by `nextjs/lib/enterprise-store.ts:142`. Neither records a document read, a compile, or (before this lane) a gate decision. |
| 13 | `least_privilege_connector_scopes_verified` | PARTIAL | Scopes are declared in code and published rather than discovered at the consent screen: `nextjs/lib/connector-oauth.ts:42,48,54`, exported as `OAUTH_CONNECTOR_SCOPES`. Google is `drive.readonly`. **Microsoft asks for `Files.Read.All` and `Sites.Read.All`, which is tenant-wide read**, not least privilege for one workspace. |
| 14 | `per_provider_isolation_verified` | MISSING | Per-connection secret envelopes exist, but nothing tests that one provider's credential or content cannot reach another provider's code path. |
| 15 | `dpa_and_privacy_notice_published` | PARTIAL | `/privacy`, `/terms` and `/subprocessors` are published. No data processing agreement exists anywhere in the repository. `nextjs/app/subprocessors/page.tsx:13-19` lists Supabase, Vercel, Cloudflare, RunPod, Paddle and Google — **not Dropbox and not Microsoft**, although live connector code exists for both. |
| 16 | `per_source_acl_preserved` | MISSING | This lane defines `shared/aclSnapshot.ts` and `public.source_acl_snapshots`. No connector captures an ACL at ingestion, and no retrieval path filters by one — `nextjs/lib/retrieval-store.ts` and `nextjs/lib/retrieval-pipeline.ts` filter by tenant and workspace only. Storage is not enforcement. |
| 17 | `founder_approval_receipt_recorded` | MISSING by design | No receipt exists. Recording one is not an agent's act, in this campaign or any other. |

Two rows EXIST, seven are PARTIAL, eight are MISSING. Blueprint §48 P0-F's acceptance — "no customer
traffic enabled until the security suite passes" — has, before this lane, no suite to point at; §2 of
this document builds one, and §5 says exactly what it does and does not prove.

---

## 3. What the code does

### `shared/customerDataGate.ts`

`evaluateCustomerDataGate({ tenantId, workspaceId, evidence, now })` returns an allowed decision only
when every one of the seventeen has exactly one evidence row, `satisfied === true`, non-blank
evidence, and a parseable `checkedAt`. Anything else is `{ allowed: false, missing: [...] }` naming
the rows that failed. `receiptSha256` is sha256 over the canonical JSON of the evidence list in frozen
precondition order, so it is a function of the evidence and not of the order the caller assembled it.

Deliberate fail-closed choices, each with a test:

- Two rows for one precondition are a disagreement, not a stronger claim → that precondition is missing.
- A blank tenant or workspace, or an unparseable `now`, refuses all seventeen rather than approving something unattributable.
- `gateAdmitsCustomerData` re-checks the schema version, the receipt digest shape, and that the tenant and workspace equal the envelope's. A decision for another tenant is not an approval.

`validateCompileJobEnvelope(input, gate?)` gained one optional parameter. Called without it — which
is every call site in this repository — the behaviour is byte-for-byte what it was:
`PRIVACY_POLICY_NOT_ALLOWED`. The pre-existing tests in
`server/foundation/productCoreCompileEnvelope.test.ts` were not touched and still pass.

### `shared/aclSnapshot.ts`

`intersectAcl(snapshots)` implements "derived knowledge cannot be more permissive than every
governing source evidence": a principal survives only if it appears in every snapshot, at the least
permissive permission any of them granted. No snapshots yields no principals — an empty argument list
means "nobody", never "everybody", because a caller that forgot to pass its snapshots must not
thereby publish.

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
- `/security` and `/workspace` both render `Object.entries(activationPolicy)` through their own label maps. `app/security/page.tsx:39` gained the matching label so the public page does not render an empty heading. `app/workspace/page.tsx` was **not** edited — it is another lane's file in this campaign — so its "Four gates" section now lists five, with the raw key `customerData` as the label. That is two lines for whoever merges: a `GATE_LABELS` row and the heading.

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
- It covers eight MISSING preconditions with nothing, because there is nothing to cover them with.
- It cannot observe the deployed platform: encryption at rest, TLS on the R2 and RunPod legs, and the actual scopes a consent screen granted are all outside it.

Green means the code in this repository behaves as its authors intended. Approving customer data
needs the eight MISSING rows implemented, the seven PARTIAL rows closed, an executed isolation suite,
and a founder receipt. Only the last of those is a decision; the rest is work.

---

## 6. For the founder

1. **Audit table.** `enterprise_audit_events` is chosen for gate events, with the organization-row consequence in §3. Confirm, or say that gate events belong somewhere a non-enterprise pilot workspace can also write.
2. **`/subprocessors` omits Dropbox and Microsoft** while live connector code exists for both (`nextjs/app/subprocessors/page.tsx:13-19` versus `nextjs/lib/connector-oauth.ts:48,54`). A public disclosure that understates who touches customer content is a disclosure defect in the direction that matters. This lane did not edit the page — public legal copy is not an agent's call.
3. **No DPA is published.** Precondition 15 cannot close without one, and its content is a legal decision.
4. **Microsoft Graph scopes** are `Files.Read.All` + `Sites.Read.All` — tenant-wide read. Least privilege for a single workspace would be narrower; narrowing them changes what the connector can do.
5. **Google Drive tombstones** (`connector-oauth-adapters.ts:79`): accepted limitation, or a bug to fix before P2 connectors? Seam-map decision O-6, still open.
6. **Retention has no enforcement job.** Building one is a delete path, which is stop-the-line territory if it is wrong. It needs its own canary and its own approval, not a checkbox on this matrix.
7. **`docs/SECURITY_BOUNDARIES.md` was factually stale** — it said the application must not accept customer document bytes, while `activation-policy.ts` has had intake, CDR and GPU OCR enabled since 2026-08-29. A dated "Current state" section now records what is true; whether the original statement should be rewritten rather than appended to is a documentation-ownership decision.
8. **Nobody may record precondition 17.** Stated here so it is on the record: an agent will not create a founder approval receipt, and a gate that could be closed by the thing it gates is not a gate.
