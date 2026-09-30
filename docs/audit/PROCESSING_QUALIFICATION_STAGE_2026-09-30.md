# Bounded processing qualification stage — decision and operator contract

Date: 2026-09-30. Status: **implemented on branch `codex/qualified-processing-bootstrap-20260930`;
not applied to production and not activated**. This document breaks the open cycle described
at the end of [`SCOPED_CUSTOMER_DATA_LAUNCH_POLICY_2026-09-29.md`](SCOPED_CUSTOMER_DATA_LAUNCH_POLICY_2026-09-29.md).
It authorizes no production release, no live charge and no public claim.

## The cycle and the decision

A `direct_upload` release needs 12 satisfied preconditions, including
`compile_receipts_signed_and_audited`. That precondition can only be observed from a real
signed and audited compile, and a real compile of customer data needs an admitted workspace.
Recording the precondition as satisfied from mechanism tests would be fabricated evidence and
is not allowed.

The parent operator, acting under the founder's standing delegation, chose a staged approach: an
explicit **qualification** stage that is not a release. It is recorded as a delegated operator
decision (`operator_actor = 'delegated-operator:<name>'`), never as a personal founder
signature, and it is never evidence by itself.

| | Qualification | Production release |
| --- | --- | --- |
| Schema version | `tavonel.customer_data_gate.v2.qualification` | `tavonel.customer_data_gate.v2` (unchanged) |
| Satisfied facts | the other 11 `direct_upload` facts, same validation (exact set, no duplicates, `satisfied: true`, checked within 30 days, not after evaluation) | all 12 (`connector`: all 17) |
| `missing` | exactly `compile_receipts_signed_and_audited` | empty |
| Scope | `direct_upload` only | as recorded |
| Workspaces | exactly one recorded `qualification_workspace_key` | any workspace with its own grant |
| Lifetime | expires ≤ 1 hour after evaluation; each grant ≤ 1 hour and ≤ that expiry | 30 days |
| Billing | never: checkout refused, never a billable renewal | as before |

A qualification decision that claims `compile_receipts_signed_and_audited`, names more or fewer than
11 facts, a second workspace, a connector scope or a longer life is refused by the evaluator
(`shared/scopedCustomerDataGate.ts`) and by table constraints (migration
`20260930070000_processing_qualification_stage.sql`).

## What still applies unchanged

Qualification runs only through the existing authenticated paths: `POST /api/access/bootstrap`
issues the grant (the only caller allowed a qualification grant), then the existing upload
capability/confirm, malware/CDR/OCR, compile and export routes. Each still requires session
membership, entitlement and quota, the exact deployed `VERCEL_GIT_COMMIT_SHA`, the current
owner's persisted acceptance of the published terms, the optional
`TAVONEL_PROCESSING_WORKSPACE_COHORT` restriction (an additional AND), ACLs, retention and the
signed-receipt audit. There is no new endpoint, admin bypass or canary route. Public flags and
copy are unchanged. Sign-in, the workspace and source export/deletion stay available to every
workspace.

## Refusals and precedence

The latest release row for `(scope, revision)` is the decision. A production or qualification
refusal recorded later ends the qualification; no code path falls back from a refusal into
qualification. The reverse is blocked in the database: once an **allowed production** release exists
for a `(scope, revision)`, the `guard_customer_data_release_stage` trigger refuses any qualification
row for it (`qualification_after_release`). Every release insert takes a transaction advisory lock
for its `(scope, revision)`, so a concurrent production approval and qualification are serialized,
and qualification inserts are refused outside READ COMMITTED (`qualification_requires_read_committed`)
so the post-lock check reads the committed row. A production *refusal* does not block a later
qualification.

A workspace's latest explicit refusal is never overwritten, and the gate reader reports it
(`SCOPED_WORKSPACE_REFUSED`) before any release state, as the grant issuer already did. An unknown
or malformed stage, a schema that does not match its stage, an extra evidence key, a stale or
expired record, the wrong workspace or the wrong SHA denies. Stage mismatches between release and
grant deny. The grant writer takes the stage from the latest release under its table lock and
enforces workspace, scope and the one-hour bound in the database, not only in the application.

## Billing

A qualification grant is never billable. `authorizationStage()` returns `qualification` for any
v2 authorization that is not consistently `production`. Live checkout returns
`PROCESSING_QUALIFICATION_NOT_BILLABLE` before creating a checkout intent. Sweeper grant renewal
never requests a qualification grant.

The window still has billing effects. They come from the deployment-wide switches it needs, not
from the qualification row. Production runs `COMMERCIAL_MODE=live` and the gate-enforce cron at
minutes 11/26/41/56 (`nextjs/vercel.json`). The sweeper pauses each Paddle subscription whose
workspace the `direct_upload` gate does not admit (`nextjs/lib/billing-gate-enforcement.ts`):

| Code the sweeper reads during the window | Class | Effect on a subscription |
| --- | --- | --- |
| `SCOPED_RELEASE_REFUSED`, `SCOPED_WORKSPACE_REFUSED` | refused | paused at the next run, whatever the billing date; "refused" notice |
| `PROCESSING_COHORT_EXCLUDED` (every workspace outside the cohort; checked before the v2 reader, so it also masks their explicit refusals), `SCOPED_RELEASE_QUALIFICATION_OTHER_WORKSPACE`, `SCOPED_RELEASE_QUALIFICATION_ONLY` (the qualification workspace itself), `SCOPED_RELEASE_NOT_FOUND` | lapsed | paused within 48 h of the next charge, or at once with refund review if the subscription is < 48 h old; otherwise deferred |

Today's v1 gate has zero receipts, so the same subscriptions already read as lapsed
(`CUSTOMER_DATA_GATE_RECEIPT_NOT_FOUND`). The window does not add a lapsed pause. It does add two
risks: a **release** refusal while v2 is on turns every workspace into "refused" (immediate pause);
and a stray qualification over an approved release, which the trigger above now prevents. The
runbook therefore requires zero live subscriptions before the window and ends the window without a
release refusal.

## Compile propagation

The compile receipt's signed payload is unchanged (`tavonel.compile_receipt.v1`). It already binds
`customerDataGateReceiptSha256`, the admitting grant's digest, whose schema names the stage. The
`compile.receipt_signed` audit row and the compile result additionally state
`customerDataGateStage`. A qualification compile's receipt is an actual receipt produced under a
labelled qualification. Using it as evidence for a later production release is a separate
operator decision that cites the receipt and audit row. This code does not make that decision.

## Operator record (qualification)

Compute the digest with the evaluator. Do not type or copy one.

```sh
# One line: the Windows npx shim drops a multi-line -e argument.
npx tsx -e 'import("./shared/scopedCustomerDataGate.ts").then(m => console.log(JSON.stringify(m.evaluateQualificationRelease(JSON.parse(process.argv[1])), null, 2)))' '{"releaseRevision":"<deployed 40-hex SHA>","workspaceId":"<pilot-… key>","now":"<evaluatedAt ISO>","expiresAt":"<≤ now+1h ISO>","evidence":[<the 11 verified facts>]}'
```

Insert the row only if the output says `"allowed": true`:
`schema_version = 'tavonel.customer_data_gate.v2.qualification'`, `stage = 'qualification'`,
`scope = 'direct_upload'`, `release_revision`, `allowed = true`, `receipt_sha256`, `evidence`
(the same 11 objects, exactly the keys `precondition, satisfied, evidence, checkedAt`),
`missing = '{compile_receipts_signed_and_audited}'`, `evaluated_at`, `qualification_workspace_key`,
`qualification_expires_at`, `operator_actor = 'delegated-operator:<name>'` and a
`decision_reason` naming the founder's standing delegation.

## Rollout sequence

1. Merge only after CI, including `db-rehearsal` (full migration chain plus the pgTAP suite).
   Apply `20260930070000_processing_qualification_stage` to production **before** deploying code
   that reads `stage`. Old code reads qualification rows as `SCOPED_RELEASE_INVALID` (fail closed).
   New code on the old schema fails its `stage` select (`STORE_FAILED`, fail closed).
2. Deploy the exact SHA. Leave `TAVONEL_CUSTOMER_DATA_GATE_VERSION` and every public flag as they
   are until the operator deliberately switches to v2 for the qualification window.
3. **Billing precondition. Do not open the window unless it holds.** Immediately before the window,
   list subscriptions from the **live Paddle API** (not only the `foundation_billing_accounts`
   projection). Confirm there are zero in `active`, `trialing`, `past_due` or `paused` for any
   workspace. Record the query time and the count. If any exist, stop: the window would expose
   them to the sweeper effects above. Never suspend or disable the gate-enforce reconciliation cron to
   work around this. Its pause intents, notices and provider reconciliation must keep running.
4. Verify the 11 facts for that SHA and record the qualification row as above (≤ 1 hour). There must
   be no allowed production release for that SHA; the database refuses the row otherwise. Set
   `TAVONEL_PROCESSING_WORKSPACE_COHORT` to the same single workspace.
5. As the workspace's current owner: sign in, accept the published terms if not already accepted,
   call bootstrap, then upload → scan/CDR → OCR → compile → signed export → deletion. Record the
   compile receipt digest and audit event id.
6. End the window by **expiry**, or by a **workspace** refusal on the operator workspace only.
   **Never record a release-wide refusal while v2 is on**: every workspace would read as refused and
   every live subscription would be paused at the next sweeper run. Then switch
   `TAVONEL_CUSTOMER_DATA_GATE_VERSION` and the cohort back. In a separate decision, evaluate the
   12-fact production release for that SHA, citing the actual receipt. Only that production row
   admits other workspaces or billing. Note that the operator-workspace refusal is permanent for that
   workspace and scope until a newer grant is issued. It also pauses that workspace's own
   subscription immediately if one exists (step 3 requires none).

Rollback: let the qualification expire (every qualification grant is dead within an hour) or record
a refusal for the operator workspace only. Then restore the previous gate version, cohort and SHA.
A release-wide refusal is a billing action, not a qualification rollback. Use it only with v2 off, or
after re-checking step 3.

## Remaining limitations

* The 11 facts must be verified against the deployed SHA before step 3. This change verifies
  none of them.
* A bootstrap under qualification still follows the existing trial rule (a trial may be minted
  for the operator workspace when it has no owner/paid access). It is an entitlement, not a
  charge. Sandbox checkout is unchanged and never reads the gate.
* The `qualification_workspace_key` is enforced against the grant; the Vercel cohort variable is
  an additional, separate operator control. The cohort check runs before the v2 reader, so under a
  cohort an excluded workspace's explicit refusal reads as `PROCESSING_COHORT_EXCLUDED` (lapsed);
  step 3's zero-subscription precondition covers that.
* The database does not bind a directly inserted qualification *grant* to its release's workspace
  or expiry. The RPC and every reader do, and direct inserts stay available for operator refusals.
* Local verification ran real pgTAP 1.3.3 on a real PostgreSQL 17.2 against a subset of the
  migration chain with minimal Supabase role/`auth.users` prerequisites. The full chain runs only in
  CI `db-rehearsal`.
