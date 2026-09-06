# USKC P0 — Lane F report (customer-data security / ACL policy gate)

Campaign `TAVONEL-USKC-P0-20260906-V1`. Contract §5 "F", §4.3, §7 R-6.
Worktree `D:/CodexProjects/uskc-lanes/site-f-customer-data-gate`, base site `4c18e86`.

**Nothing in this lane enables anything.** `activationPolicy.customerData.enabled` is `false`, the
live compile request builder still writes `foundation_synthetic_only` as a literal, seven of the
seventeen preconditions are MISSING and eight more are PARTIAL, and no code in the repository can assemble an allowed evidence
set. Production deploy 안 함. Git push로 Preview deployment는 자동 생성됨.

---

## 1. Branch and pushed SHA

Branch `agent/uskc-f-customer-data-gate`, four commits on top of `4c18e86`:

| SHA | Subject |
|---|---|
| `dc670f8` | Gate customer data behind seventeen evidenced preconditions |
| `223b01d` | Record gate decisions and source ACLs in two append-only tables |
| `fc1e286` | Say the customer-data gate is closed, and test the live path |
| `5d2c338` | Name a security suite, and write down what it does not prove |
| `fc3b349` | Report lane F: gates, failure paths, conflicts and founder decisions |

Pushed SHA of the last code commit: `fc3b349c6eccd36ab5d29cb380b6eb23671a676f`. One further commit
after it fills this line in, so the branch head is later than the SHA written here — a file cannot
contain the digest of the commit that adds it. The head SHA is in the returned structured object.
Preview deployment auto-created; not verified — the Vercel MCP was not consulted from this lane.

## 2. Files

### Created

- `shared/customerDataGate.ts` — `CUSTOMER_DATA_GATE_SCHEMA`, `PreconditionEvidence`, `CustomerDataGateDecision`, `evaluateCustomerDataGate`, `customerDataEvidenceReceiptSha256`, `gateAdmitsCustomerData`.
- `shared/aclSnapshot.ts` — `ACL_SNAPSHOT_SCHEMA`, `AclSnapshot`, `aclSnapshotSha256`, `intersectAcl`.
- `shared/uskcEnums.ts` — **lane AB's file byte-for-byte** since repair round 2 (§8.1 C-AB-3), sha256 `6dceb23128bb902c554006fde8255c90b2f686a3688fe1617c440084c7ac1c9f`. It was an independent transliteration of `contract/enums.v1.json` in the first pass; the values matched, the export names did not.
- `server/foundation/customerDataGate.test.ts` (**35** tests), `server/foundation/aclSnapshot.test.ts` (**34**), `server/foundation/customerDataGateMigration.test.ts` (**9**). Corrected in repair round 2: this line still carried the first pass's 18 / 9 / 7 after the first repair had added tests, which a reviewer contradicted. These are `pnpm exec vitest run <file>` counts at the head of round 2.
- `supabase/migrations/0050_customer_data_gate_acl.sql` — `source_acl_snapshots`, `customer_data_gate_receipts`.
- `nextjs/lib/customer-data-live-path.test.ts` (4 tests).
- `docs/CUSTOMER_DATA_GATE_2026-09-06.md` — the 17-row gap matrix, the audit-table decision, the suite, the founder list.

### Modified — row-only, inside the ownership row

| File | Change |
|---|---|
| `shared/productCoreCompileEnvelope.ts` | One import, one optional second parameter, one condition. Without `gate` the behaviour is byte-for-byte what it was; `server/foundation/productCoreCompileEnvelope.test.ts` is untouched and green. |
| `nextjs/lib/activation-policy.ts` | One key: `customerData: { enabled: false, reason: … }`. |
| `nextjs/lib/capabilities.ts` | One grid row: `gate("customerData", "Customer-data compilation", …)`. |
| `package.json`, `nextjs/package.json` | One `security:suite` script each (contract §7 R-6 authorises exactly this). |
| `docs/SECURITY_BOUNDARIES.md` | Appended a dated "Current state (2026-09-06)" section; the stale text above it is left for the record (§7 R-6 authorises this). |

### Modified — outside the ownership row (both reported, neither optional)

| File | Change | Why it could not be avoided |
|---|---|---|
| `nextjs/lib/capabilities.test.ts` | `toHaveLength(9)` → `10`, two lines. | The row count is pinned by the test that owns the grid I was told to add a row to. Adding the row without this leaves the branch red. |
| `nextjs/app/security/page.tsx:44` | One label row `customerData: "Compiling customer data"` in `CAPABILITY_LABELS`. | The page renders `Object.entries(activationPolicy)` and looks each key up in that map with **no fallback** (`:115`). Without the row, the public security page renders an empty `<h2>` for the new capability. The file is owned by no lane in §3. |

### Deliberately **not** modified in the first pass, **modified in repair round 2** (see R2.3)

`nextjs/app/workspace/page.tsx` also renders `Object.entries(activationPolicy)` (`:2401`) under the
heading **"Four gates"** (`:2395`), through `GATE_LABELS` (`:157`) with a `?? key` fallback. The new
key therefore renders as the literal `customerData` under a heading that now undercounts by one. The
file is lane D's row-only file, so this lane did not touch it. **Two lines for the integrator or for
lane D:** a `GATE_LABELS` row, and "Four gates" → "Five gates".

*(First-pass text, kept as the record and superseded by R2.3: §8.1 authorised F to close this seam,
so the file **is** edited on this branch — a `GATE_LABELS` row, `GATE_LABELS` typed
`Record<ActivationCapability, string>`, and the heading changed to "Processing gates" rather than to
another number that goes stale.)*

## 3. Gates

All run from the worktree. Root `node_modules` was **absent** on arrival (only `nextjs/node_modules`
was installed by the orchestrator, contrary to the contract §2 statement); `pnpm install
--frozen-lockfile` at the worktree root, exit 0, was run first so the required root gates could run
at all.

| # | Command (cwd) | Exit | Output tail |
|---|---|---|---|
| 0a | `pnpm check` (worktree root) | **0** | `> tsc --noEmit` — no diagnostics. First run was exit 2 with `shared/aclSnapshot.ts(98,34): error TS2802 … Map can only be iterated with --downlevelIteration` and `(107,47) TS7053`; the root tsconfig sets no `target`. Fixed by using plain records instead of `Map` iteration. |
| 0b | `pnpm test` (worktree root) | **0** | `Test Files 25 passed (25)` · `Tests 96 passed (96)` · Duration 3.21s. **This row is the first pass's measurement and was not updated when the first repair added tests, which a reviewer contradicted; R.9 and R2.5 carry the current figures (116, then 140).** First run was exit 1: `customerDataGateMigration.test.ts > is one transaction … expected false to be true` — my assertion required the file to *start* with `begin;`, but migrations here open with a header comment (0043 does too). Replaced with "exactly one `begin;` and one `commit;`, file ends with `commit;`". |
| 1 | `pnpm check` (`nextjs/`) | **0** | `> tsc --noEmit && eslint app components lib` — no diagnostics. |
| 2 | `pnpm test` (`nextjs/`) | **0** | `Test Files 164 passed (164)` · `Tests 1583 passed (1583)` · Duration 28.88s. First run was exit 1 with one failure: `lib/capabilities.test.ts:90 … expected [ …(10) ] to have a length of 9 but got 10` — the pinned grid row count, resolved as described in §2. Zero regressions; +4 tests over the pre-change nextjs count. |
| 3 | `pnpm build` (`nextjs/`) | **0** | `✓ Generating static pages (69/69)` · `First Load JS shared by all 103 kB`. **69 static pages.** |
| 4 | `PLAYWRIGHT_PORT=3143 PLAYWRIGHT_WEB_SERVER_TIMEOUT=900000 pnpm exec playwright test --project=1440 --project=390 --project=reduced-motion e2e/ultimate-blueprint.spec.ts e2e/production-hardening.spec.ts` (`nextjs/`) | **0** | `12 skipped` · `15 passed (2.2m)`. Includes `Security record exposes fail-closed controls without certification claims` green at 1440, 390 and reduced-motion — the spec that reads the `/security` list I added a row to. First attempt failed with `Error: Timed out waiting 120000ms from config.webServer` because the config's webServer runs `pnpm build && pnpm start` and `prebuild` re-runs check+test; raising `PLAYWRIGHT_WEB_SERVER_TIMEOUT` is the config's own escape hatch and changes nothing in the repo. |
| 5 | `pnpm security:suite` (worktree root) — the new gate | **0** | `Test Files 8 passed (8)` · `Tests 46 passed (46)`. |
| 6 | `pnpm security:suite` (`nextjs/`) — the new gate | **0** | `Test Files 9 passed (9)` · `Tests 62 passed (62)`. |
| 7 | `git status` | clean except the intended changes (listed in §2) | — |

**Skipped, with the reason:** `supabase/tests/tenant_rls_matrix.sql` was not executed. There is no
wired runner, no `pnpm` script invokes it, and neither Docker nor the Supabase CLI is installed on
this machine. This is exactly precondition 1's PARTIAL status and is recorded as such, not worked
around. No migration was applied anywhere.

## 4. Failure paths tested

Every one the lane spec names, plus the ones the shape of the decision object made reachable:

- 16 of 17 satisfied → refused, naming the single missing precondition.
- Zero evidence → refused, naming all seventeen.
- Precondition marked `satisfied: true` with blank evidence → that precondition is missing.
- Two disagreeing rows for one precondition → missing (a duplicate is a disagreement, not a stronger claim).
- `checkedAt` that is not an ISO-8601 instant → missing. This now includes the strings `Date.parse` tolerates — `"2026"`, `"0"`, `"2026-09-06"`, `"Sat Sep 6 2026"` (corrected in the repair pass, R.4; the earlier wording covered only unparseable strings).
- Blank tenant, or an unparseable `now` → all seventeen refused, nothing approved unattributably.
- Envelope with `approved_customer_data` and **no gate** → unchanged `PRIVACY_POLICY_NOT_ALLOWED`.
- Envelope with any privacy policy outside the frozen vocabulary — unknown value, empty string, wrong case — → `PRIVACY_POLICY_NOT_ALLOWED` whether or not an allowed gate is supplied (repair pass, R.1).
- Gate from another tenant (allowed for `tenant_02`) → refused.
- Gate from another workspace of the same tenant → refused.
- Hand-built "allowed" decision whose `receiptSha256` is not sha256-**shaped** → refused. A sha256-shaped string that derives from no evidence **is admitted**; that ceiling is stated in R.5 and in the gate doc §3, and is pinned by its own test.
- Decision carrying an unimplemented `schemaVersion` → refused.
- Behind an allowed gate, every other envelope rule still applies (traversal key → `OBJECT_KEY_INVALID`).
- The synthetic path is identical with and without a gate argument.
- `intersectAcl`: a public source plus a private one grants nobody `anyone` access; least permissive grant wins, never the most; same id under a different kind is a different principal; a snapshot listing one principal twice resolves to the weaker grant; no snapshots and one empty snapshot both grant nobody; and a grant whose kind or permission is outside the frozen vocabulary **refuses the whole intersection** (`ACL_VOCABULARY_UNKNOWN`), so it can neither preserve another snapshot's stronger grant nor be emitted as an invented permission — including the seven `Object.prototype` names, which the "dropped rather than ranked" version of this bullet was still false for (repair round 2, R2.1; the earlier R.2 wording is superseded).
- Migration: allowed rows unwritable without 17 + digest + empty `missing`; refusals must name a reason; `missing` constrained to the frozen names; both tables client-denied and insert-only; no `insert into`, no `update public.`, no `'approved_customer_data'` literal, no third audit table.

## 5. What the blueprint asked that I did not do, and why

1. **Enforce ACLs.** `AclSnapshot` and `intersectAcl` are defined and tested; nothing captures a snapshot at ingestion and nothing filters retrieval by one. Contract §7 R-6 makes connector ACL capture P2 work. The doc says so plainly, because an ACL type with no consumer looks like coverage and provides none.
2. **Containment between principal kinds** in `intersectAcl` (`anyone` ⊇ `domain` ⊇ `group` ⊇ `user`). Not implemented: expanding a group to its members needs a directory lookup this repository does not have, and every containment rule can only *widen* the result. The strict identity intersection is the version that cannot leak while the lookup is missing. Consequence stated in code and doc: a public source and a single-user source intersect to nobody, which is a human decision, not a guess.
3. **Retention enforcement**, **customer data export/delete**, **AV scanning**, **per-provider isolation proof**, **compile-receipt signing**. All MISSING rows in the matrix, none of them P0-F build work, and a retention sweeper is a delete path — stop-the-line territory if wrong. Named for the founder rather than half-built.
4. **`nextjs/lib/core-runtime-v2.ts`** untouched, per §7 R-6. The literal `foundation_synthetic_only` is a fail-closed gate; the lane asserts it rather than replacing it.
5. **`nextjs/app/subprocessors/page.tsx`** untouched, per §7 R-6. Its omission of Dropbox and Microsoft is verified (`:13-19` versus `nextjs/lib/connector-oauth.ts:48,54`) and recorded for the founder; public legal copy is not an agent's call.
6. **`shared/candidateWorldContract.ts`** untouched. The seam map is right that it is not on the live promotion path, and a gate built there would silently not apply.
7. **No `uskcEnums` test file.** `server/foundation/uskcEnums.test.ts` belongs to lane AB in §3. The frozen-value assertion my lane needs (`CustomerDataPrecondition` in order, `PrivacyPolicy`) lives inside `server/foundation/customerDataGate.test.ts` instead.

## 6. Conflicts with other lanes or with the contract (proposals, not edits)

- **C-F-1 — CLOSED in repair round 2 (R2.3):** §8.1 authorises F to fix this seam itself, and it is fixed. The text below is left for the record. ~~`nextjs/app/workspace/page.tsx` needs two lines from lane D or the integrator.~~ See §2. `GATE_LABELS` (`:157`) row for `customerData`, and "Four gates" (`:2395`) → "Five gates". Not edited: it is lane D's row-only file.
- **C-F-2 — `nextjs/lib/capabilities.test.ts` is not assigned in §3** but is pinned to the row count of `nextjs/lib/capabilities.ts`, which §3 gives to F. Whoever adds a grid row must edit its test. Proposal: name the test file alongside the module in the ownership row.
- **C-F-3 — `nextjs/app/security/page.tsx` is not assigned in §3** but `CAPABILITY_LABELS` (`:39-44`) has no fallback, so any lane adding an `activationPolicy` key must add a label there or ship an empty heading on a public page. Proposal: either assign the file, or give the lookup a `?? key` fallback in a later pass.
- **C-F-4 — WITHDRAWN in repair round 2 (R2.7 item 3).** It claimed `shared/uskcEnums.ts` could not be verified byte-identical to lane AB's copy from inside this worktree. It could, in one command, and the copies were not identical — they differed in every exported identifier, not in whitespace. §8.1 C-AB-3 settles it and this worktree now carries AB's bytes. The original text is struck rather than deleted: ~~"…the values are what must match, not the whitespace."~~
- **C-F-5 — Contract §2 says site worktrees have `nextjs/node_modules` installed and lists root `pnpm check` / `pnpm test` as required gate 0.** The root has no `node_modules`, so gate 0 cannot run as delivered. I installed at the worktree root (exit 0, ~11 min). Other site lanes will hit the same wall.
- **C-F-6 — The frozen `CustomerDataPrecondition` list has no `av_scan_verdict_present` value.** The gap matrix distinguishes CDR (disarm and reconstruct, live) from an antivirus verdict (absent everywhere in the repository), and `malware_scan_and_quarantine_active` currently has to carry both. Proposal only; a lane does not add a frozen value.

## 7. Contradictions found (contract, seam map, blueprint) — with paths

- **Seam map, LANE F "Creates"** proposes `shared/customerDataGate.test.ts`, `nextjs/lib/acl-snapshot.ts` and `supabase/migrations/0051_source_acl_snapshots.sql`. All three are superseded by contract §3 and §7 R-1 (tests under `server/foundation/`, the ACL type in `shared/`, migration 0050). Followed the contract, as instructed.
- **Seam map, LANE F "Exposes"** gives a seven-value `CustomerDataPrecondition` union, an `AclSnapshot` with `provider`/`role`/`contentSha256`, and a `CustomerDataGateResult` with `failed`. The frozen `contract/enums.v1.json` has seventeen values, and contract §4.3 names `providerId`/`permission`/`snapshotSha256` and `missing`. Followed the frozen artifacts and §4.3.
- **Seam map, LANE F "Modifies"** requires editing `nextjs/lib/core-runtime-v2.ts`, `connector-oauth-adapters.ts`, `connector-oauth-store.ts` and `app/subprocessors/page.tsx`. Contract §7 R-6 forbids all four. Followed the contract.
- **`connector-oauth-adapters.ts` — the Drive `trashed = false` query is at line 79, not line 80** as the seam map states. The gap itself is real and verified: Drive drops trashed files silently while Dropbox (`:114`) and Graph (`:154`) emit `kind: "deleted"`.
- **`nextjs/lib/capabilities.ts` has no page consumer.** Its module comment calls it "the one table on the marketing page that makes factual assertions about what this deployment can actually do", and `nextjs/lib/capabilities.test.ts:95` describes a landing-page summary printing "N of 9 controls are open". Neither is true in this build: the only importers of `readCapabilities` are `lib/compiler-contract.ts` (which reads one word) and tests, and `brand-copy.test.ts:161` actively asserts the landing page does **not** import it. The grid is real code with no surface. Recorded, not fixed — the fix is a founder/UI decision.
- **`docs/SECURITY_BOUNDARIES.md` was stale**, as the seam map said: it forbids accepting customer document bytes while `nextjs/lib/activation-policy.ts` has had intake, CDR and GPU OCR enabled since 2026-08-29. Appended a dated current-state section under §7 R-6; the old text stays.
- **Contract §4.3's `isImmutableScopedObjectKey` interaction is worth a note, not a change.** `shared/productCoreCompileEnvelope.ts:82` requires `immutable/<tenantId>/<workspaceId>/`, while the live key layout is `immutable/<workspaceId>/<workspaceId>/` (`nextjs/lib/immutable-keys.ts`). Those agree only because `buildProductCoreV2Request` sets `tenantId: workspaceId` (`core-runtime-v2.ts:157`). The gate inherits that identity assumption, and it is a decided one: RESOLVED B-2 keeps tenant and workspace separate concepts, contract §8.1 ("AB tenant shim") accepts recording `tenantId = workspaceId` as the P0 shim because the wire carries one value, and the v2 key layout is a later migration and ADR. Seam-map O-4 is answered by those two; the ADR is lane AB's record, not F's.

## 8. Open questions for the founder — none; the nine below are closed and cited

Repair round 3 rewrote this section as required by contract §8.2 ("F — cite, do not re-ask"). Every
item was a question in the first pass and is now a statement of the standing decision with the item
that closed it: `USKC_FOUNDER_DECISIONS_RESOLVED_2026-09-06.md` or contract §8.1 / §8.2. The same
rewrite is in `docs/CUSTOMER_DATA_GATE_2026-09-06.md` §6, which is the version that survives this
report. This lane opens no new founder question.

1. **Audit table, and the `organization_id` consequence — decided.** RESOLVED B-6: `enterprise_audit_events` is the canonical log for customer source/data security events, `foundation_developer_audit_events` keeps developer/API/configuration acts, and there is no third table. Contract §8.2 rules that its `organization_id NOT NULL` — a workspace with no enterprise organization row cannot record a gate event and therefore cannot be approved — is the intended fail-closed direction. Built that way; nothing changes.
2. **`/subprocessors` — decided, no change.** RESOLVED A-5: source providers are not TAVONEL subprocessors; Dropbox and Microsoft are not added because connector code exists, only after the production customer-data architecture delegates processing to them and legal review confirms. The gap-matrix row for precondition 15 records their absence as an architectural fact, not a disclosure defect.
3. **DPA — open until legal, by decision.** RESOLVED B-10 lists DPA and privacy disclosures among the prerequisites for allowlisted-beta enablement; contract §8.2 records precondition 15 as open until legal. It stays PARTIAL until a DPA is published, which is a legal act.
4. **Microsoft Graph scopes → P2.** `Files.Read.All` + `Sites.Read.All` is tenant-wide read (precondition 13). Contract §8.2 assigns the narrowing to P2, with the connector work RESOLVED §D sequencing item 6 places there.
5. **Google Drive tombstones — a blocker, decided.** RESOLVED B-7: the `trashed = false` gap (`connector-oauth-adapters.ts:79`) is not an acceptable production limitation. P0 records it; connector qualification is `BLOCKED` and no connector is `VERIFIED` until tombstone, delete, permission-change and move/rename semantics are implemented and verified. Precondition 9 stays MISSING; seam-map O-6 is answered by B-7.
6. **Retention enforcement → P2/P3, with its own approval.** Contract §8.2. Precondition 10 stays PARTIAL — policy stored, nothing enforcing it — and the sweeper ships with its own canary and its own approval, not in this lane.
7. **`docs/SECURITY_BOUNDARIES.md` — appended, not struck.** Contract §8.1 settles it: the stale statements stay, the dated "Current state" section stands beside them, historical text is not overwritten. What this lane did is what the ruling requires.
8. **Precondition 17 — a fact, not a question.** Contract §8.2: the founder approval receipt is recorded only by the founder. No agent creates one; a gate that can be closed by the thing it gates is not a gate. Row 17 is `MISSING by design`.
9. ~~**Should the receipt digest bind the subject?**~~ **DONE per contract §8.1, implemented in repair round 2 (R2.5).** §4.3 is amended: the digest covers `tenantId` and `workspaceId` together with the preconditions, so a receipt is not portable between tenants.

---

# Repair pass (2026-09-06)

Two adversarial reviewers examined the branch: one NO_GO on fail-closed correctness, one
GO_WITH_CONDITIONS on contract and honesty conformance. Both reproduced their findings with probes.
Five distinct defects were confirmed; four are fixed in code, one is answered with evidence because
the contract forbids the edit. Every claim of the previous report that a reviewer contradicted is
corrected below and in the document it appeared in — the corrections are the point, not a footnote.

## R.1 Blocker — the gate was a denylist

`shared/productCoreCompileEnvelope.ts:127`. The condition was
`privacyPolicy !== "foundation_synthetic_only" && !gateAdmitsCustomerData(...)`. With a gate present
that admitted **every** other string a deserialized JSON body can carry — an unknown policy, the
empty string, any value added to the union later — not only `approved_customer_data`. Contract §4.3
says the opposite: accepts `approved_customer_data` **only** when `gate.allowed === true`. Standing
rule §1 says an unknown value is never a silent pass-through. Both reviewers reproduced it.

Fixed as an allowlist: the value must equal `"approved_customer_data"` **and** the gate must admit
it. Without a gate, and on the synthetic path, the behaviour is unchanged, and
`server/foundation/productCoreCompileEnvelope.test.ts` remains untouched and green.

Tests: `customerDataGate.test.ts` — `refuses privacyPolicy %j even behind an allowed gate` over
`"raw_customer_pii_no_redaction"`, `""`, `"approved_customer_dataX"`, `"APPROVED_CUSTOMER_DATA"`,
and `accepts only the two values the frozen vocabulary spells`. Verified adversarially: with the old
condition restored the four parameterised cases fail (`Tests 9 failed | 21 passed`); with the fix
they pass. Not exploitable in the deployed build — no call site passes a gate and
`buildProductCoreV2Request` hard-codes the literal — which is why it was latent, not a live leak.

## R.2 Major — `intersectAcl` widened on a grant it could not rank

`shared/aclSnapshot.ts:88,107`. `PERMISSION_RANK[unknown]` is `undefined` and every `<` against
`undefined` is false, so `owner ∩ "admin"` kept `owner` and `"admin" ∩ read` emitted the invented
value `"admin"`. Reachable from stored data, not only from a cast: migration 0050 constrained
`principals` only by size and secret shape.

Fixed in two places, because the value crosses the type boundary in two:

- `rankOf` returns `undefined` for a kind or permission outside the frozen vocabulary, and such a
  principal is dropped before any comparison — absent from that snapshot, so the intersection cannot
  keep another snapshot's more permissive grant.
- Migration 0050 now constrains every stored element with two jsonpath checks, so the column will not
  store a value the intersection cannot rank.

Tests: `aclSnapshot.test.ts` — `intersectAcl with a grant outside the frozen vocabulary` (4 cases:
owner ∩ junk → nobody; junk ∩ read → nobody, never `"admin"`; an unrankable duplicate row cannot
become the snapshot's grant; an unknown `kind` is dropped) and
`customerDataGateMigration.test.ts` — `constrains every stored principal to the frozen kind and
permission vocabulary`. Verified adversarially: with the guard removed, 3 of the 4 fail.

## R.3 Major — the file was binary to git

`shared/aclSnapshot.ts` carried three raw NUL bytes as the principal-key separator, so
`git diff origin/main..HEAD --stat` printed `Bin 0 -> 4738 bytes` and the one security-critical
module in the lane had no reviewable diff, in the branch or in a PR. Confirmed on the committed
blob, not just the working tree.

Fixed: the separator is `String.fromCharCode(0)`, a named constant. Runtime behaviour is byte-for-byte
what it was; the source is now plain ASCII. (a backslash-u-0000 source escape was the first attempt and
is equivalent; `fromCharCode` survives an editor or formatter round-trip that an escape sequence
inside a template literal might not.)

Test: `aclSnapshot.test.ts` — `contains no raw control bytes` reads the module as bytes and asserts
none outside tab/LF/CR/printable-ASCII, so a raw NUL cannot come back unnoticed; a second case pins
that the separator still distinguishes `" x"` from `"x"`. The diff for this file is textual again.

## R.4 Major — `checkedAt` accepted things that are not instants

`shared/customerDataGate.ts:52`. `isInstant` was non-blank plus `Date.parse`, and `Date.parse`
accepts `"2026"`, `"0"`, `"2026-09-06"` and `"Sat Sep 6 2026"`. A seventeen-row set stamped `"0"`
with `now: "0"` produced an **allowed** gate stamped `evaluatedAt: "0"`. The previous report's
failure path "checkedAt that does not parse → missing" was therefore true only of unparseable
strings, which is not what a reader takes it to mean.

Fixed: the value must match an ISO-8601 instant with an explicit offset **and** be a real date.

Tests: `customerDataGate.test.ts` — five parameterised cases over the strings `Date.parse` tolerates,
plus `refuses everything when now is not an instant, and never stamps a decision with it`. Verified
adversarially: with the old `isInstant` restored, all five fail.

## R.5 Major — the receipt digest is checked for shape, never re-derived

`shared/customerDataGate.ts:133`. Confirmed and **not** closed in `gateAdmitsCustomerData`, with the
reason stated rather than smoothed over. `sha256:` + 64 zeroes is admitted; only a non-sha256-shaped
string is refused, and the previous report's "hand-built allowed decision with a non-digest
`receiptSha256` → refused" overstated that. The decision type frozen in contract §4.3 carries no
evidence, so re-derivation from the decision alone is structurally impossible, and contract §4.3
also fixes the digest as being over the evidence list alone — so binding tenant and workspace into
it, which would close the reviewer's related P7 (identical digest across tenants), is a change to a
frozen interface and is a proposal, not an edit. A row is attributed by its `tenant_id` and
`workspace_id` columns.

What is done instead: the ceiling is written into `docs/CUSTOMER_DATA_GATE_2026-09-06.md` §3 in the
words above, and the migration's promise ("a later reader can re-derive `receipt_sha256` instead of
trusting it") is made executable and tested —
`customerDataGateMigration.test.ts` → `stores the evidence a reader re-derives receipt_sha256 from`
re-derives the digest from a row-shaped evidence fixture with the exported
`customerDataEvidenceReceiptSha256`, and shows a tampered row producing a different digest. A new
test pins the admitted case explicitly as a known ceiling, so closing it later breaks a test rather
than passing silently.

**Founder question added:** should contract §4.3's digest definition be amended to bind
`tenantId`/`workspaceId`, so a stored receipt digest is not portable between tenants? That is an
edit to a frozen interface and not a lane's call.

## R.6 Major, disputed on the remedy — `nextjs/app/workspace/page.tsx` — **dispute withdrawn in round 2 (R2.3)**

**Superseded.** Contract §8.1 authorises F to make this edit, so the seam is fixed on this branch and
the reasoning below — correct under §1 and §3 as they read at the time — no longer applies. Kept for
the record, not as a live position.


The finding is factually right and I reproduced it: `activationPolicy` now has five keys,
`GATE_LABELS` (`:157-162`) has four, the heading at `:2395` says "Four gates", and the `?? key`
fallback at `:2403` renders the raw `customerData`. The Preview created by this branch carries it.

I did not fix it, and will not, because the remedy the finding implies contradicts the contract that
governs this lane. `nextjs/app/workspace/page.tsx` is **lane D's** file in contract §3
("row-only edits: `nextjs/app/workspace/page.tsx` (~line 1680 …)"), and §1 is explicit: "Do not touch
other lanes' files (§3). If you must, stop and report the conflict instead of editing." Lane D is
running now; editing its file creates the merge conflict the ownership rows exist to prevent. That
is also the distinction from the two files I *did* edit and disclosed: `nextjs/app/security/page.tsx`
and `nextjs/lib/capabilities.test.ts` are assigned to **no** lane in §3, so editing them collides
with nobody, and both were forced (an unowned test pins the row count of a file §3 gives to F; the
public `/security` page looks the key up with no fallback and would ship an empty `<h2>`).

The exact patch for lane D or the integrator, unchanged from C-F-1:

```diff
-  ocrGpu: "GPU OCR",
+  ocrGpu: "GPU OCR",
+  customerData: "Customer-data compilation",
-        <h2>Four gates</h2>
+        <h2>Five gates</h2>
```

## R.7 Major — a hand-typed count contradicted its own table

`docs/CUSTOMER_DATA_GATE_2026-09-06.md:63,182,186` said "seven are PARTIAL, eight are MISSING". The
seventeen-row table above it is 2 EXISTS / 8 PARTIAL / 7 MISSING. Counted by hand and by regex; the
reviewer is right and the direction of the error understated how much is only PARTIAL. Corrected in
all three places, now with the row numbers so the claim is checkable against the table
(EXISTS 4, 7 · PARTIAL 1, 3, 5, 6, 10, 12, 13, 15 · MISSING 2, 8, 9, 11, 14, 16, 17), and in this
report's opening paragraph, which repeated it.

## R.8 Corrections to §1 of this report

- "four commits on top of `4c18e86`" — the table beneath it listed five and the branch carried
  seven. The branch now carries ten; the head SHA is in the returned structured object.
- "Pushed SHA of the last code commit: `fc3b349…`" — `fc3b349` was the report commit; the last code
  commit at that time was `5d2c338`. Written as a correction rather than edited away.

## R.9 Gates rerun after the repair — all of them, real exit codes

| Command (cwd) | Exit | Tail |
|---|---|---|
| `pnpm check` (worktree root) | 0 | `> tsc --noEmit` — no diagnostics |
| `pnpm test` (worktree root) | 0 | `Test Files 25 passed (25)` · `Tests 116 passed (116)` (was 96; +20 from this repair) |
| `pnpm check` (`nextjs/`) | 0 | `> tsc --noEmit && eslint app components lib` — no diagnostics |
| `pnpm test` (`nextjs/`) | 0 | `Test Files 164 passed (164)` · `Tests 1583 passed (1583)` — zero regressions |
| `pnpm build` (`nextjs/`) | 0 | `+ First Load JS shared by all 103 kB`; 69 static pages, same as before |
| `PLAYWRIGHT_PORT=3143 PLAYWRIGHT_WEB_SERVER_TIMEOUT=900000 pnpm exec playwright test --project=1440 --project=390 --project=reduced-motion e2e/ultimate-blueprint.spec.ts e2e/production-hardening.spec.ts` (`nextjs/`) | 0 | `12 skipped` · `15 passed (2.2m)` — reproduced on the first attempt this pass; reviewer 1 could not reproduce it while two sessions shared this worktree, and the worktree was clean of foreign files when I ran it |
| `pnpm security:suite` (worktree root) | 0 | `Test Files 8 passed (8)` · `Tests 66 passed (66)` (was 46) |
| `pnpm security:suite` (`nextjs/`) | 0 | `Test Files 9 passed (9)` · `Tests 62 passed (62)` |
| `supabase/tests/tenant_rls_matrix.sql` | **skipped** | Unchanged reason: no wired runner, and neither Docker nor the Supabase CLI is installed. This *is* precondition 1's PARTIAL status; it is recorded, never worked around. No migration was applied anywhere. |

Adversarial verification of the new tests: each fix was reverted in a scratch copy and the suite
rerun. The reverts produced `Tests 9 failed | 21 passed` (customerDataGate) and
`9 failed | 36 passed` (both files) — the failures are exactly the new cases, so each fix has a test
that would have caught the defect. Sources were restored from the backups and every gate above was
run against the restored files.

## R.10 What the repair did not change

Nothing enables anything, and the repair narrowed rather than widened:
`activationPolicy.customerData.enabled` is still `false` with the contract's verbatim reason,
`buildProductCoreV2Request` is untouched, `shared/uskcEnums.ts` still matches `contract/enums.v1.json`
value-for-value and order-for-order, migration 0050 still creates exactly two tables and inserts
nothing, and no `research/`, `docs/evidence/`, `docs/ip/` or Protected Core path is touched. One
observation from a reviewer's refutation notes, recorded and not acted on because it is outside this
lane's row: `route.operationClass` and `route.qualityRequirement` are likewise never validated
against their unions in `validateCompileJobEnvelope`. Pre-existing, unchanged by this lane, and a
one-line fix for whoever owns that file next.

---

# Repair round 2 (2026-09-06)

Input: `REPAIR2_FINDINGS_2026-09-06.json` key `F` — one blocker, five majors, seven report-level
contradictions — and contract §8.1, the orchestrator's rulings, which answer every question this
lane's first report raised. Nothing below re-asks a founder resolution, and nothing below enables
anything: `activationPolicy.customerData.enabled` is still `false`, `buildProductCoreV2Request` is
still untouched, migration 0050 still inserts nothing, and no migration was applied anywhere.
Production deploy 안 함. Git push로 Preview deployment는 자동 생성됨.

Every finding is fixed. None is disputed: each one reproduced before anything was changed.

## R2.1 Blocker — `intersectAcl` still widened, and still invented a permission

`shared/aclSnapshot.ts:50`. The first repair closed only the out-of-vocabulary permissions that are
not `Object.prototype` members. `PERMISSION_RANK` was a plain object literal, so
`PERMISSION_RANK["constructor"]` is a **function**, not `undefined`: `rankOf` returned truthy
garbage, the principal was neither refused nor dropped, `owner ∩ "__proto__"` kept `owner`, and
`"constructor" ∩ "constructor"` emitted `permission: "constructor"` — a value outside the frozen
`AclPermission` vocabulary, which is invented data. Reproduced at the primitive
(`node -e 'const R={read:0,write:1,owner:2}; typeof R["constructor"]'` → `function`) and through the
module before touching it.

Fixed exactly as §8.1 rules ("F ACL and pages"): the rank table is a `Map`, which has no prototype
chain to answer from, and a kind or permission outside the frozen vocabulary now **refuses the whole
intersection** by throwing `ACL_VOCABULARY_UNKNOWN` instead of dropping the principal. One
deliberate widening of §8.1's letter: an unknown *kind* refuses too, not only an unknown permission.
Both are the same evidence — that the ACL being intersected is not the ACL that was captured — and
refusing both is a shorter function than refusing one and dropping the other. Refusing rather than
dropping is the point: dropping returned a plausible answer computed from a vocabulary that had
already been violated, which is the shape of a leak nobody reviews.

Failure paths (`server/foundation/aclSnapshot.test.ts`, now 34 cases): ten out-of-vocabulary
permissions — `admin`, the seven `Object.prototype` names, `propertyIsEnumerable`, the empty
string — in two directions each (can it preserve an `owner` grant; can it be emitted), an unrankable
row duplicating a principal that would otherwise survive, an unknown `kind`, and that the message
names the value it refused. Adversarially verified: with the object-literal rank restored, **23 of
the 34** cases in this file fail; restored, 34 pass.

## R2.2 Major — `shared/uskcEnums.ts` was a third variant, not AB's copy

§8.1 C-AB-3: AB's file is the one copy; D and F replace theirs with its bytes and rewrite their
imports. Done. `shared/uskcEnums.ts` is now
`git show origin/agent/uskc-ab-source-domain:shared/uskcEnums.ts` verbatim — sha256
`6dceb23128bb902c554006fde8255c90b2f686a3688fe1617c440084c7ac1c9f`, byte-identical to AB's blob,
verified by hashing both. The three importers move to AB's camelCase names
(`CUSTOMER_DATA_PRECONDITIONS` → `customerDataPreconditions`, `PRIVACY_POLICIES` →
`privacyPolicies`); nothing else changed, because the value lists were already equal to
`contract/enums.v1.json` value-for-value and order-for-order.

The guard against a drifted copy is the one already committed and still green:
`customerDataGate.test.ts` pins the seventeen preconditions in frozen order and the two privacy
policies against hand-written literals, so a copy carrying different **values** fails whichever
lane's file the integration merge keeps. I did not add a sha256-of-the-file test: this repository
checks out CRLF on Windows, and pinning a digest of a working-tree file is exactly the trap that
produced lane C's withdrawn evidence-hash escalation.

## R2.3 Major — the workspace integrity panel, fixed rather than reported

`nextjs/app/workspace/page.tsx`. §8.1: "F fixes the two seams it created: the workspace integrity
panel heading and `GATE_LABELS` row for `customerData`, and the `CAPABILITY_LABELS` row on
`/security` — these one-block edits are now authorised for F." The first pass reported this as
conflict C-F-1 and declined to edit lane D's file; that reading is superseded and the fix is in.

- `GATE_LABELS` gains the `customerData` row.
- `GATE_LABELS` is typed `Record<ActivationCapability, string>` and the `?? key` fallback is gone.
  The fallback is what let the raw camelCase key render instead of failing; the type makes a policy
  key added without a label a `tsc` error, and `pnpm check` and `prebuild` both run `tsc`.
- The heading is **"Processing gates"**, not "Five gates". A heading that spells a count in words
  goes stale every time a policy key is added — which is exactly how it broke — so the count leaves
  the heading rather than being incremented and left to rot again. Nothing pinned the old string
  (`grep -rn "Four gates"` finds only the dead `client/src/pages/Workspace.tsx`).

Failure path, verified adversarially: delete the `customerData` label row and `tsc --noEmit` fails
with `app/workspace/page.tsx(164,7): error TS2741: Property 'customerData' is missing in type … but
required in type 'Record<"customerIntake" | "cdr" | "ocrGpu" | "candidatePromotion" |
"customerData", string>'`. Restored, tsc is clean.

## R2.4 Major — the two files edited outside the §3 ownership row

Confirmed as reported, resolved by ruling rather than by reverting:

- `nextjs/app/security/page.tsx:44` (the `CAPABILITY_LABELS` row) is **now authorised** by §8.1, in
  the same sentence that authorises the workspace fix. Left in place, one row, unchanged.
- `nextjs/lib/capabilities.test.ts` (`toHaveLength(9)` → `10`) stays, recorded as what it is: a file
  §3 assigns to no lane, pinning the row count of `nextjs/lib/capabilities.ts`, which §3 *does* give
  to F as a one-row edit. The row edit is impossible without it — reverting the test leaves the
  branch red on a gate the contract requires — so it is the compulsory consequence of an authorised
  edit, not a second edit of my choosing. C-F-2's proposal stands: name a module's test file
  alongside the module in the ownership row.

`docs/SECURITY_BOUNDARIES.md` (appended, dated) and the two `security:suite` scripts are covered by
§7 R-6 and were disclosed in the first report; §8.1's last bullet confirms SECURITY_BOUNDARIES is
appended, not struck.

## R2.5 §4.3 amended — the receipt digest binds the subject

§8.1: "§4.3 is amended: the gate receipt digest covers `tenantId` and `workspaceId` together with
the preconditions, so a receipt is not portable between tenants." This was founder question 9 in the
first report and the second half of R.5's stated ceiling; the ruling answers it, so it is code now.

`customerDataEvidenceReceiptSha256(subject, evidence)` canonicalises
`{ evidence, schemaVersion, tenantId, workspaceId }`. The evidence half is unchanged — seventeen
rows in frozen order, sorted keys — so the digest is still independent of the order the caller
assembled the array in. It mattered because evidence rows are paths, receipt digests and test ids,
none of them tenant-specific: two tenants with the same evidence produced the identical digest, and
a digest copied out of an approved tenant re-derived true for an unapproved one.

The first half of the ceiling is unchanged and still stated in
`docs/CUSTOMER_DATA_GATE_2026-09-06.md` §3: `gateAdmitsCustomerData` checks the digest's **shape**,
because the frozen decision type carries no evidence to re-derive from. What closes it is the
durable row — and re-deriving a row's digest now also proves the row was not lifted from another
tenant's approval.

Failure paths: the digest bound to one tenant and one workspace; an allowed decision stamped with
its own subject's digest; and the migration's re-derivation test showing the same evidence under
another tenant not re-deriving the row's digest.

## R2.6 Report-level — `checkedAt` admitted a day that does not exist

`shared/customerDataGate.ts:55` promised "the value must also be a real date" and the guard was the
ISO shape plus `Date.parse` finiteness. `Date.parse` range-checks an ISO day against 31 rather than
against its month, so `"2026-02-30T00:00:00Z"` is instant-shaped, parses finite and is silently
re-read as 2026-03-02. Reproduced: `node -e "Date.parse('2026-02-30T00:00:00Z')"` → `1772409600000`,
which renders `2026-03-02T00:00:00.000Z`.

Fixed rather than retracted, because the claim is the one worth keeping: the day must spell itself
back through `Date.UTC`. Hours, minutes and seconds need no such check — `Date.parse` already
returns `NaN` for `"T99:99:99Z"`, which the finiteness test refuses. Three impossible days are
appended to the parameterised `checkedAt` refusals (`2026-02-30T00:00:00Z`,
`2027-02-29T12:00:00.000Z`, `2026-04-31T00:00:00+09:00`).

Adversarial check covering R2.5 and R2.6 together: with both guards reverted, **6 of the 44** cases
in the two gate test files fail, and they are exactly the six new ones. Restored, 44 pass.

## R2.7 Claims a reviewer contradicted — corrected here and in the document

1. "`intersectAcl` with an out-of-vocabulary permission → the principal is dropped, so it can
   neither preserve another snapshot's owner grant nor be emitted as an invented permission [NEW —
   fixes the confirmed widening]" — **was false** for every prototype-inherited key. `owner ∩
   "__proto__"` still yielded `owner`; `"constructor" ∩ "constructor"` still emitted
   `permission: "constructor"`. R.2's framing ("`intersectAcl` never widens") was therefore still
   wrong after the first repair. It is true now, and by a different mechanism: the intersection is
   refused, not narrowed. §4's failure-path bullet and the module docstring say the new behaviour.
2. The test named "never emits an invented permission value" did not establish what its name
   claimed — it exercised only `"admin"`, the one out-of-vocabulary class that already happened to
   be refused. Replaced by ten parameterised cases in each of two directions.
3. **C-F-4 was wrong twice over and is withdrawn.** "`shared/uskcEnums.ts` cannot be verified
   byte-identical to lane AB's copy from inside this worktree" — it can, in one command against an
   absolute sibling path, and when run it showed the copies were **not** identical and differed in
   every exported identifier, not in whitespace as C-F-4 speculated. The conclusion it drew from
   that unverified premise ("the values are what must match, not the whitespace") was wrong, and it
   is the kind of claim this campaign exists to stop. Superseded by R2.2: the file is AB's bytes.
4. Report §2's test counts (18 / 9 / 7) and §3 gate row 0b's `Tests 96 passed (96)` were the first
   pass's measurements, left stale after the first repair added tests. Both corrected in place, each
   marked with the pass its figure belongs to.
5. "`pnpm build` (nextjs/) — exit 0 did not reproduce as delivered; it exits 1 with ENOENT on a
   stale `.next` and reproduces only after deleting it." Accepted as reported. In round 2 the build
   ran twice: once after `rm -rf .next` (exit 0) and once again immediately on the resulting tree
   (exit 0), so the row below is reproducible from the state this branch is pushed in. The hazard is
   real and environmental — several lanes build in sibling worktrees on this machine.
6. Report §1's commit count and the SHA it names were already corrected in writing in R.8; §1 is
   left standing with R.8 and this section as its correction. The branch now carries fourteen
   commits; the head SHA is in the returned structured object, because a file cannot contain the
   digest of the commit that adds it.

## R2.8 Gates — all of them, rerun at round 2, real exit codes

| # | Command (cwd) | Exit | Output tail |
|---|---|---|---|
| 0a | `pnpm check` (worktree root) | **0** | `> tsc --noEmit` — no diagnostics |
| 0b | `pnpm test` (worktree root) | **0** | `Test Files 25 passed (25)` · `Tests 140 passed (140)` · Duration 3.23s (116 at the end of the first repair; +24 here) |
| 1 | `pnpm check` (`nextjs/`) | **0** | `> tsc --noEmit && eslint app components lib` — no diagnostics |
| 2 | `pnpm test` (`nextjs/`) | **0** | `Test Files 164 passed (164)` · `Tests 1583 passed (1583)` — zero regressions |
| 3 | `pnpm build` (`nextjs/`) | **0** | `✓ Generating static pages (69/69)` · `First Load JS shared by all 103 kB`. **69 static pages**, unchanged. Run twice: after `rm -rf .next`, then again on the resulting tree |
| 4 | `PLAYWRIGHT_PORT=3143 PLAYWRIGHT_WEB_SERVER_TIMEOUT=900000 pnpm exec playwright test --project=1440 --project=390 --project=reduced-motion e2e/pipeline-board.spec.ts e2e/ultimate-mobile-a11y.spec.ts e2e/ultimate-blueprint.spec.ts e2e/production-hardening.spec.ts` (`nextjs/`) | **1** | `6 failed · 14 skipped · 34 passed (4.2m)`. All six are two `e2e/pipeline-board.spec.ts` cases at each of the three projects, and both are **pre-existing** — proof below |
| 5 | `pnpm security:suite` (worktree root) | **0** | `Test Files 8 passed (8)` · `Tests 90 passed (90)` (66 after the first repair) |
| 6 | `pnpm security:suite` (`nextjs/`) | **0** | `Test Files 9 passed (9)` · `Tests 62 passed (62)` |
| 7 | `git status --porcelain` | clean | empty output; every change is committed |
| — | `supabase/tests/tenant_rls_matrix.sql` | **skipped** | Unchanged reason: no wired runner, and neither Docker nor the Supabase CLI is on this machine. This *is* precondition 1's PARTIAL status; recorded, never worked around |

**The Playwright failure, proven pre-existing.** `e2e/pipeline-board.spec.ts:65` ("processing detail
appears only when the user asks for it") and `:80` ("ready sources are searchable without
lengthening the whole page") both time out waiting for
`getByRole("button", { name: "Processing 1" })` on `/workspace`. I checked **origin/main's own**
`nextjs/app/workspace/page.tsx` out over mine and reran `--project=1440 e2e/pipeline-board.spec.ts`:
the same two cases fail (`2 failed · 2 passed`), so the failure is in the branch's base, not in this
lane's edit. My file was restored immediately afterwards and `git status` is clean. The spec is not
in this lane's ownership row and was not touched. The other three specs — including
`e2e/ultimate-blueprint.spec.ts`'s "Security record exposes fail-closed controls without
certification claims", which reads the `/security` list this lane added a row to — pass at 1440, 390
and reduced-motion.

The specs run are the ones that navigate to a page this lane edited (`/workspace`, `/security`);
`e2e/mobile-landing.spec.ts` belongs to lane D's navigation change and is not touched here.

## R2.9 What round 2 did not change

No PR, no merge, no deploy, no migration applied, no third-party dependency added, no
`research/model_arena_20260903/**` and no Protected Core path in the diff, and no fabricated receipt
or count anywhere in this section — every number above is a command's own output. `intersectAcl` is
strictly more refusing than it was, the gate digest is strictly narrower, `isInstant` accepts
strictly fewer strings, and the workspace panel prints one more written label. Nothing widened.

Still open, unchanged, and not this lane's to close: C-F-5 (root `node_modules` absent on arrival),
C-F-6 (no `av_scan_verdict_present` in the frozen precondition list), and every founder question in
§8 except number 9, which §8.1 answered and R2.5 implements. *(Superseded by §8.2 and repair round
3: the §8 items were not open questions at all — the founder and the orchestrator had already closed
all nine, and §8 now states them as decisions.)*

---

# Repair round 3 (2026-09-06, final)

One item, and it is a documentation item: contract §8.2 rules that lane F cites the closed decisions
rather than re-asking them. Nothing about the gate's behaviour was wrong, so nothing in the gate
changed. No new test ships with this round because no code path changed — the round's whole content
is the removal of eight questions that had already been answered.

## R3.1 Major — founder questions 2–8 were re-asked after §8.1 closed them

`USKC_LANE_REPORT_F.md` §8 and `docs/CUSTOMER_DATA_GATE_2026-09-06.md` §6 both listed eight items as
open founder questions. Every one had already been decided, and §8.2 names the decision for each.
Both sections are rewritten as statements, in the same order, each carrying the item that closed it:

| # | Was asked as | Now states | Closed by |
|---|---|---|---|
| 1 | "Confirm that fail-closed direction, or say gate events belong somewhere every workspace can write" | `enterprise_audit_events` is the canonical log; `organization_id NOT NULL` is the intended fail-closed direction and stays | RESOLVED B-6 + contract §8.2 |
| 2 | "`/subprocessors` omits Dropbox and Microsoft … the defect direction that matters" | Source providers are not TAVONEL subprocessors; neither is added until the production architecture delegates processing and legal confirms. Not a disclosure defect, no change | RESOLVED A-5 |
| 3 | "No DPA is published … its content is a legal decision" | Precondition 15 stays PARTIAL and open until legal publishes a DPA; it is one of B-10's enablement prerequisites | RESOLVED B-10 + §8.2 |
| 4 | "Narrowing them changes what the connector can do" | Graph scope narrowing is P2, with the rest of the connector work | Contract §8.2 + RESOLVED §D item 6 |
| 5 | "accepted limitation, or fix before P2 connectors?" | Not an acceptable production limitation. Connector qualification is `BLOCKED`; no connector is `VERIFIED` until tombstone, delete, permission-change and move/rename semantics are verified | RESOLVED B-7 |
| 6 | "Building one … needs its own canary and its own approval" | Retention enforcement is P2/P3 and ships with its own approval; precondition 10 stays PARTIAL | Contract §8.2 |
| 7 | "Say if the stale paragraph should be struck instead" | Appended, not struck — historical text is not overwritten. What this lane did is what the ruling requires | Contract §8.1 |
| 8 | "Stated for the record …" (framed as a question by its position in the list) | Precondition 17 is recorded only by the founder. A fact, and row 17 is `MISSING by design` | Contract §8.2 |
| 9 | Already struck in round 2 | The receipt digest binds `tenantId` and `workspaceId`; implemented in R2.5. **DONE** | Contract §8.1 |

§8's heading now says there are no open founder questions, because there are none: this lane opened
no new one in any round.

## R3.2 Three statements that had gone false, corrected in the same pass

A document that cites a ruling and then contradicts it elsewhere is worse than one that asks, so the
three places where the prose still described a superseded state are fixed:

1. `docs/…GATE…md` gap-matrix row 9 (`deletion_tombstone_propagation_verified`) recorded the Drive
   `trashed = false` gap with no status. It now carries B-7's ruling: connector qualification
   `BLOCKED`, no connector `VERIFIED`, P2.
2. Row 15 (`dpa_and_privacy_notice_published`) named Dropbox and Microsoft as missing from
   `/subprocessors` in a way that read as a defect. It now cites A-5, which is why they are absent,
   and B-10 for the DPA itself.
3. `docs/…GATE…md` §4 still said `app/workspace/page.tsx` "was **not** edited … two lines for
   whoever merges". §8.1 authorised the edit and round 2 made it; the bullet now describes what the
   file actually contains, including `GATE_LABELS` typed `Record<ActivationCapability, string>` and
   the heading "Processing gates". The first-pass claim in report §2 is marked superseded rather
   than deleted, as is R2.9's closing line about §8.

Report §7's note on seam-map O-4 also stopped calling the tenant/workspace identity "still the open
question": RESOLVED B-2 keeps the two concepts separate and §8.1 accepts `tenantId = workspaceId` as
the P0 shim, with the key layout deferred to a later migration and ADR — lane AB's record.

## R3.3 Gates — all rerun at round 3, real exit codes

| # | Command (cwd) | Exit | Output tail |
|---|---|---|---|
| 0a | `pnpm check` (worktree root) | **0** | `> tsc --noEmit` — no diagnostics |
| 0b | `pnpm test` (worktree root) | **0** | `Test Files 25 passed (25)` · `Tests 140 passed (140)` · Duration 3.12s |
| 1 | `pnpm check` (`nextjs/`) | **0** | `> tsc --noEmit && eslint app components lib` — no diagnostics |
| 2 | `pnpm test` (`nextjs/`) | **0** | `Test Files 164 passed (164)` · `Tests 1583 passed (1583)` — unchanged from round 2, zero regressions |
| 3 | `pnpm build` (`nextjs/`) | **0** | `✓ Compiled successfully in 39.7s` · `✓ Generating static pages (69/69)` · `First Load JS shared by all 103 kB`. **69 static pages**, unchanged. Run twice on the same tree, both exit 0 |
| 5 | `pnpm security:suite` (worktree root) | **0** | `Test Files 8 passed (8)` · `Tests 90 passed (90)` |
| 6 | `pnpm security:suite` (`nextjs/`) | **0** | `Test Files 9 passed (9)` · `Tests 62 passed (62)` |
| 4 | Playwright | **not rerun** | Round 3 changed two Markdown files and no page, route, component or style. R2.8 row 4 stands, including its proof that the two `e2e/pipeline-board.spec.ts` failures are pre-existing on the base — which contract §8.2 has since recorded for the integration report as not any lane's to fix |
| — | `supabase/tests/tenant_rls_matrix.sql` | **skipped** | Unchanged reason: no wired runner, and neither Docker nor the Supabase CLI is on this machine. That absence *is* precondition 1's PARTIAL status |

## R3.4 What round 3 did not change

No code, no test, no migration, no schema. No PR, no merge, no deploy, no migration applied, no
third-party dependency, nothing under `research/model_arena_20260903/**`, no Protected Core path, no
other lane's file. `activationPolicy.customerData.enabled` is still `false`, the live request builder
still writes the `foundation_synthetic_only` literal, and seven preconditions are still MISSING — so
no evidence set that exists today produces an allowed decision. Production deploy 안 함. Git push로
Preview deployment는 자동 생성됨.
