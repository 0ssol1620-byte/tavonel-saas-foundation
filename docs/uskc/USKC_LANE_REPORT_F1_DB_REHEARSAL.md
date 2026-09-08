# USKC P0 — Lane F1 report (migration rehearsal and the tenant RLS matrix, executed)

Campaign `TAVONEL-USKC-P0-20260906-V1`, workstream F. Lane contract §8.1/§8.2, gap matrix addendum
rows L-1 to L-4, founder §36–§37, `docs/CUSTOMER_DATA_GATE_2026-09-06.md` precondition 1.
Worktree `D:/CodexProjects/uskc-lanes/site-f1-db-rehearsal`, branch `agent/uskc-f1-db-rehearsal`,
based on `agent/uskc-integration` `7c8b1e1`.

**This lane changed no migration, no schema and no live system.** It added a GitHub Actions job that
applies `supabase/migrations/0001` through `0050` to a throwaway Postgres 17 and runs the pgTAP
suite against it, then repaired the fixtures that asserted a contract the chain no longer has. No
project ref, access token or database URL reaches that job, by construction: it proves what the
files say and nothing about the live Supabase project. Production deploy 안 함. No pull request, no
merge, no migration written.

**The DB rehearsal is red at branch head, and that is the deliverable, not a failure to hide.** One
fixture cannot complete its plan because a shipped RPC cannot execute on a database built from these
files. §4 says exactly which, why, and whose repair it is.

---

## 1. Runs and conclusions, verbatim

Every row is a run on `agent/uskc-f1-db-rehearsal`. A passing run here is a receipt about these
files on a GitHub runner. Nothing in this table says anything about production.

| Run | Workflow | Commit | Conclusion |
|---|---|---|---|
| https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/34015466410 | DB rehearsal | `c5aebd2` | failure |
| https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/34016125836 | DB rehearsal | `9744f49` | failure |
| https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/34016618815 | DB rehearsal | `ba48b85` | failure |
| https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/34016618801 | CI | `ba48b85` | success |
| https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/34016618845 | Launch QA | `ba48b85` | success |
| https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/34018318802 | DB rehearsal | `28ed931` | failure |
| https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/34018318799 | CI | `28ed931` | success |
| https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/34018318793 | Launch QA | `28ed931` | success |

The runs triggered by the commit that adds this file are later than the file and are recorded in the
lane's returned structured output — a report cannot contain the digest of the run its own commit
produces.

Artifact from every DB rehearsal run, taken before the tests so a red suite still leaves it:
`schema-after-0050` → `schema-after-0050.sql`. The copy the orchestrator holds at
`D:/CodexProjects/uskc-lanes/reports/artifacts/f1-schema-after-0050/schema-after-0050.sql` is
sha256 `fc929d6e5a9fa6de681ba31e25ac872978219b17d84c825314fc88134da77884` and is the artifact of run
34016618815.

## 2. What the rehearsal does

`.github/workflows/db-rehearsal.yml`, on `push` to `main` and `agent/**`, `pull_request` and
`workflow_dispatch`:

1. `supabase/setup-cli@v1` pinned to CLI `2.116.0` — the version the receipt
   (`research/RECEIPT_SUPABASE_DB_TESTING_AND_BRANCHING_2026-09-06.md` §2) records as latest stable
   on 2026-09-06. `latest` would let a CLI release change what the receipt means with no commit
   saying so.
2. `supabase init` if no `config.toml` exists, then `grep -qx 'major_version = 17'` — a rehearsal on
   any other major version proves nothing about a production running Postgres 17.6.1.165.
3. `supabase db start` — applies every file under `supabase/migrations` in filename order to a
   throwaway Postgres. **This is the rehearsal.** A failure in this step is the finding.
4. `supabase migration list --local`, then `supabase db dump --local --schema public` uploaded as an
   artifact for the read-only diff against production that L-2 still needs.
5. `create extension if not exists pgtap with schema extensions`, then `supabase test db`.

No new runtime dependency. GitHub Actions and the pinned CLI are tooling; the only pgTAP install is
a CLI call inside the job.

The Docker constraint is settled and not worked around: `supabase test db` "Runs `pg_prove` in a
container", unconditionally, with no `--db-url`/`--linked` escape (receipt §2). The build machine has
no Docker; a GitHub runner does. That is the entire trick.

## 3. Status of each addendum row after this lane

Vocabulary is the founder's (`program/TAVONEL_WORLD_CLASS_PROGRAM_PLAN_2026-09-06.md` §1). No row
here is `PRODUCTION_*`: this lane never touched a deployment or the live database.

| Row | Before | After this lane | Why |
|---|---|---|---|
| L-1 route probe | IMPLEMENTED_NOT_LIVE | **IMPLEMENTED_NOT_LIVE** | The probe exists and passes, but in CI it probes a locally built server (§6). Unchanged until it runs against a deployment. |
| L-2 migration history | UNRESOLVED | **UNRESOLVED** | Half the evidence now exists: the chain applies to an empty database and the resulting schema is an artifact. The read-only `information_schema` diff against production has not been done, and it is the orchestrator's read-only call, not this lane's. |
| L-3 policy-less tables | IMPLEMENTED_NOT_RUNTIME_VERIFIED | **IMPLEMENTED_NOT_RUNTIME_VERIFIED** | `tenant_rls_matrix.sql` now executes, 49 assertions, on a database built from the files. It has never run against production, so the runtime that matters is still unverified. |
| L-4 audit RPC | IMPLEMENTED_NOT_RUNTIME_VERIFIED | **UNRESOLVED** | The leak is now reproduced on a clean chain rather than inferred from an advisor: the fixture asks for a refusal and pgTAP prints `not ok 43 ... # TODO`. Repair is a migration this lane may not write. |
| Customer-data gate precondition 1 | PARTIAL | **PARTIAL** | `PARTIAL` is that document's own row status and stays until the suite is green and has run somewhere that matters. It is red at head, so the precondition cannot advance on this branch. |

## 4. The one red file, and what it means

Run 34018318802, step `Run the pgTAP suite`: `Files=11, Tests=230`, `Result: FAIL`, one file failing.

```
psql:.../supabase/tests/foundation_retrieval_search_rpc.sql:237: ERROR:  operator does not exist: public.vector <=> public.vector
...
  Parse errors: Bad plan.  You planned 20 tests but ran 14.
```

**Fails in CI on a clean 0001–0050 database.** `0020_retrieval_foundation.sql:9` runs
`create extension if not exists vector;` with no schema, so the type and its operators land in
`public`. `0023_retrieval_search_rpc.sql:104-105` declares
`search_foundation_retrieval_units_dense` `security definer set search_path = ''`, and `:153` uses a
bare `<=>`. With an empty search path the operator cannot be resolved, so the dense search RPC
raises `42883` on its first call, the transaction aborts, and the six assertions after `:237` never
run — which is why the file reports a bad plan rather than a failed test.

This report says nothing about how the RPC behaves on production. The advisor row L-7 records that
the live project also has `vector` in `public`, which makes the same failure plausible there, but
plausible is not measured: answering it needs one read-only call against production and that is the
orchestrator's to make, not this lane's.

Repair is a migration — schema-qualify the operator (`operator(public.<=>)`) or give the function a
search path that contains the extension's schema — and `supabase/migrations/` has a single writer
that is not this lane (`USKC_STOP_THE_LINE_CONTRACT_2026-09-06.md:35`). The fixture is left exactly
as written. Pinning the failure with a passing `throws_ok('42883')` was considered and rejected: it
would turn a broken shipped RPC green, and pgTAP's `todo` cannot rescue the assertions after it
either, because `todo` changes how a result is *reported* and does not catch an exception raised
while evaluating an `is()` argument — the transaction aborts before `is()` is called. A red run is
the honest receipt and the workflow was built to treat it as one.

## 5. The two assertions that are red but no longer fail the file

Both were red in every earlier run and no commit message named them. Both assert a contract we want
and a schema that does not have it, so both now run under `todo_start`/`todo_end`: the run prints
`not ok ... # TODO`, the file passes, and the day the migration lands pgTAP reports it as
unexpectedly passing, which is what makes a todo get removed instead of forgotten.

**(a) `supabase/tests/foundation_world_lifecycle.sql:25-27` (assertion 13 of 28) — `service role
cannot bypass lifecycle RPC updates`.** `0007_foundation_world_lifecycle.sql:68-71` revokes on the three lifecycle tables from
`public, anon, authenticated` only, then grants `select` to `service_role`. Supabase's default
privileges already granted `service_role` everything, and nothing revokes it: the run's own
`schema-after-0050.sql:6451` carries
`GRANT ALL ON TABLE public.foundation_world_versions TO service_role` (default privileges at
`:6551`). The server credential can therefore `update` a world version directly, bypassing
`promote_foundation_candidate` / `rollback_foundation_world` and the one-active-world unique index's
intended path. Present since the first run, 34015466410. Repair: a revoke migration.

**(b) `supabase/tests/tenant_rls_matrix.sql:223-225` (assertion 43 of 49) — `a read-only member
cannot append a system action to its own audit log`.** This is L-4, and the fixture previously *pinned* it with a passing
`results_eq` that asserted the leak. That is a green mark on a defect, so it now asserts the gap
matrix's own acceptance test for L-4 — "read-only member appends system action → refused" — and
fails as a todo. `0014:208` gates `append_enterprise_audit_event` on `organization:read`, which the
`viewer` role holds, and `p_action` is free text; an auditor cannot tell a system event from one a
member wrote. Repair: revoke `execute` from `authenticated`, or constrain `p_action` and stamp a
source column.

## 6. Fixture drift repaired, and the assertion added

**`foundation_intake_admission.sql` test 13 was stale, not a defect.** It asserted
`foundation_intake_idempotency_conflict` when the same identity is re-reserved with a different byte
count. `0008:72-76` did compare `requested_bytes`; `0026_foundation_intake_replay.sql:1-3` dropped
that comparison deliberately — "Provider-native exports can be byte-variant while retaining the same
immutable revision. Treat that case as an existing admission … Identity, owner, object key and MIME
remain strict" — and `0048_intake_size_and_experience_contract.sql:52-56`, the definition the chain
ends on, still compares only user, object key and MIME. The fixture now asserts what 0026 wrote: a
retry of a confirmed admission with a different byte count is an idempotent replay. `plan()`
unchanged; the strictness that remains is still asserted by the line below it and by the row count
above. The consequence worth a founder decision is in §8.

**`tenant_rls_matrix.sql` had an allow half with no deny half.** Three section-3 rows —
`workspaces`, `workspace_memberships`, `workspace_entitlements` — were `isnt_empty` because the
`on_auth_user_created` trigger gives every user a personal workspace as well, so a count is not
fixed. `isnt_empty` proves a member can reach its own tenant and nothing more: a policy returning
every workspace to every session would have passed. Section 4 now asks the cross-tenant question for
all three, and `plan()` goes 46 → 49. Run 34018318802 reports `Tests=230` against 227.

## 7. L-1 and what CI actually probed — corrected

`nextjs/e2e/launch-qa-capability-truth.spec.ts` probes `/api/v1/capabilities` and `/sources`, and
compares the page against the manifest row for row and in order: the MIME types
(`th[scope='row'] > i:first-of-type`, matching `source-capability-table.tsx:78-80`) and, added here,
the support statuses (`tbody .src-tier`, `:115`). Without the second comparison the page could print
the right format under the wrong tier, which is the same lie in a quieter place.

**What the green run proves is narrower than the file used to claim.** `.github/workflows/launch-qa.yml:41`
runs `playwright test --project=launch-<browser>` and sets no `PLAYWRIGHT_BASE_URL`, so
`nextjs/playwright.config.ts:19` and `:58-61` start `pnpm build && pnpm start` and the suite probes
that local server. Run 34016618845 passed all three launch projects; that says the routes are served
by a production build of these files and says **nothing** about tavonel.com, which still answers 404
on both. The spec header now says so. **L-1 stays IMPLEMENTED_NOT_LIVE** until the probe runs with
`PLAYWRIGHT_BASE_URL` pointed at a deployment.

## 8. L-2, with the arithmetic corrected

Commit `51274aa`'s message says "records 19 of the 50" and "the tables of the missing 31 exist". Both
numbers are wrong and the correction stands here rather than in rewritten history. From
`program/SNAPSHOT_2026-09-06.md:27-33` and the addendum row L-2:

- The migration history table holds **19 rows**, which are **16 distinct migrations**: `0001` appears
  four times (four versions on 2026-08-27), plus `0020`–`0023` and `0038`–`0048`.
- Within `0002`–`0048`, **32 migrations are unrecorded**: `0002`–`0019` (18) and `0024`–`0037` (14).
- `0049` and `0050` are not on production at all.
- Tables were observed for a **six-migration sample** — `0002`, `0005`, `0012`, `0014`, `0024`,
  `0037` — not for every unrecorded migration. "The tables exist" is true of that sample and is not
  yet a statement about all 32.

The workflow header (`.github/workflows/db-rehearsal.yml:3-6`) is worded correctly. **L-2 stays
UNRESOLVED** until the read-only diff of production's `information_schema` against
`schema-after-0050.sql` is actually done (`SNAPSHOT_2026-09-06.md:35`). Repairing the history table
afterwards is a production mutation and needs the founder.

## 9. Findings handed on

Three need a migration, which this lane may not write, and one needs the founder.

1. **P1-A, dense retrieval RPC (§4).** `search_foundation_retrieval_units_dense` cannot execute on a
   database built from `0001`–`0050`. Schema-qualify `<=>`/`<->`/`<#>` or set a search path that
   includes the `vector` extension's schema. Related but separate: addendum L-7 wants `vector` moved
   out of `public` by expand/contract, which would break any unqualified operator again if the
   function's search path is not fixed first.
2. **P1-A, world-version grants (§5a).** Revoke `insert, update, delete` on
   `foundation_world_versions` (and its two siblings) from `service_role`, or state in
   `SECURITY_BOUNDARIES.md` that the lifecycle RPC is advisory for the server credential. Today the
   fixture asks for the first and the schema does the second.
3. **P1-A, audit RPC (§5b, L-4).** Revoke `execute` from `authenticated`, or constrain `p_action` to
   a server-owned enum and stamp a `source` column.
4. **Founder, intake byte variance (§6).** Since `0026` a confirmed admission answers a retry with a
   *different* byte count as an idempotent replay, and the stored `requested_bytes` keeps the first
   value. That is deliberate for byte-variant provider exports, and it also means the admission's
   recorded size can disagree with the bytes that eventually land, on the row the rate limiter sums
   over. Whether that is acceptable metering is a product decision, not a fixture decision.

## 10. What this lane did not do

No file under `supabase/migrations` was added or edited. Nothing was applied to the live Supabase
project, no Supabase branch was created (a paid action), no pull request was opened, nothing was
merged, nothing was deployed, and no secret or `.env.production.local` was read. The customer-data
gate's precondition 1 is not advanced by this branch.
