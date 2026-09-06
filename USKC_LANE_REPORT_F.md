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
- `shared/uskcEnums.ts` — the frozen `contract/enums.v1.json` vocabulary as TS const arrays plus derived unions.
- `server/foundation/customerDataGate.test.ts` (18 tests), `server/foundation/aclSnapshot.test.ts` (9), `server/foundation/customerDataGateMigration.test.ts` (7).
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

### Deliberately **not** modified, reported as a conflict instead

`nextjs/app/workspace/page.tsx` also renders `Object.entries(activationPolicy)` (`:2401`) under the
heading **"Four gates"** (`:2395`), through `GATE_LABELS` (`:157`) with a `?? key` fallback. The new
key therefore renders as the literal `customerData` under a heading that now undercounts by one. The
file is lane D's row-only file, so this lane did not touch it. **Two lines for the integrator or for
lane D:** a `GATE_LABELS` row, and "Four gates" → "Five gates".

## 3. Gates

All run from the worktree. Root `node_modules` was **absent** on arrival (only `nextjs/node_modules`
was installed by the orchestrator, contrary to the contract §2 statement); `pnpm install
--frozen-lockfile` at the worktree root, exit 0, was run first so the required root gates could run
at all.

| # | Command (cwd) | Exit | Output tail |
|---|---|---|---|
| 0a | `pnpm check` (worktree root) | **0** | `> tsc --noEmit` — no diagnostics. First run was exit 2 with `shared/aclSnapshot.ts(98,34): error TS2802 … Map can only be iterated with --downlevelIteration` and `(107,47) TS7053`; the root tsconfig sets no `target`. Fixed by using plain records instead of `Map` iteration. |
| 0b | `pnpm test` (worktree root) | **0** | `Test Files 25 passed (25)` · `Tests 96 passed (96)` · Duration 3.21s. First run was exit 1: `customerDataGateMigration.test.ts > is one transaction … expected false to be true` — my assertion required the file to *start* with `begin;`, but migrations here open with a header comment (0043 does too). Replaced with "exactly one `begin;` and one `commit;`, file ends with `commit;`". |
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
- `intersectAcl`: a public source plus a private one grants nobody `anyone` access; least permissive grant wins, never the most; same id under a different kind is a different principal; a snapshot listing one principal twice resolves to the weaker grant; no snapshots and one empty snapshot both grant nobody; and a grant whose kind or permission is outside the frozen vocabulary is dropped rather than ranked, so it can neither preserve another snapshot's stronger grant nor be emitted as an invented permission (repair pass, R.2).
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

- **C-F-1 — `nextjs/app/workspace/page.tsx` needs two lines from lane D or the integrator.** See §2. `GATE_LABELS` (`:157`) row for `customerData`, and "Four gates" (`:2395`) → "Five gates". Not edited: it is lane D's row-only file.
- **C-F-2 — `nextjs/lib/capabilities.test.ts` is not assigned in §3** but is pinned to the row count of `nextjs/lib/capabilities.ts`, which §3 gives to F. Whoever adds a grid row must edit its test. Proposal: name the test file alongside the module in the ownership row.
- **C-F-3 — `nextjs/app/security/page.tsx` is not assigned in §3** but `CAPABILITY_LABELS` (`:39-44`) has no fallback, so any lane adding an `activationPolicy` key must add a label there or ship an empty heading on a public page. Proposal: either assign the file, or give the lookup a `?? key` fallback in a later pass.
- **C-F-4 — `shared/uskcEnums.ts` cannot be verified byte-identical to lane AB's copy** from inside this worktree. Mine is a mechanical transliteration of `contract/enums.v1.json` in file order with `as const` arrays plus derived unions. If AB's differs in formatting, the integration merge should keep one copy — the contract already says it will — and the values are what must match, not the whitespace.
- **C-F-5 — Contract §2 says site worktrees have `nextjs/node_modules` installed and lists root `pnpm check` / `pnpm test` as required gate 0.** The root has no `node_modules`, so gate 0 cannot run as delivered. I installed at the worktree root (exit 0, ~11 min). Other site lanes will hit the same wall.
- **C-F-6 — The frozen `CustomerDataPrecondition` list has no `av_scan_verdict_present` value.** The gap matrix distinguishes CDR (disarm and reconstruct, live) from an antivirus verdict (absent everywhere in the repository), and `malware_scan_and_quarantine_active` currently has to carry both. Proposal only; a lane does not add a frozen value.

## 7. Contradictions found (contract, seam map, blueprint) — with paths

- **Seam map, LANE F "Creates"** proposes `shared/customerDataGate.test.ts`, `nextjs/lib/acl-snapshot.ts` and `supabase/migrations/0051_source_acl_snapshots.sql`. All three are superseded by contract §3 and §7 R-1 (tests under `server/foundation/`, the ACL type in `shared/`, migration 0050). Followed the contract, as instructed.
- **Seam map, LANE F "Exposes"** gives a seven-value `CustomerDataPrecondition` union, an `AclSnapshot` with `provider`/`role`/`contentSha256`, and a `CustomerDataGateResult` with `failed`. The frozen `contract/enums.v1.json` has seventeen values, and contract §4.3 names `providerId`/`permission`/`snapshotSha256` and `missing`. Followed the frozen artifacts and §4.3.
- **Seam map, LANE F "Modifies"** requires editing `nextjs/lib/core-runtime-v2.ts`, `connector-oauth-adapters.ts`, `connector-oauth-store.ts` and `app/subprocessors/page.tsx`. Contract §7 R-6 forbids all four. Followed the contract.
- **`connector-oauth-adapters.ts` — the Drive `trashed = false` query is at line 79, not line 80** as the seam map states. The gap itself is real and verified: Drive drops trashed files silently while Dropbox (`:114`) and Graph (`:154`) emit `kind: "deleted"`.
- **`nextjs/lib/capabilities.ts` has no page consumer.** Its module comment calls it "the one table on the marketing page that makes factual assertions about what this deployment can actually do", and `nextjs/lib/capabilities.test.ts:95` describes a landing-page summary printing "N of 9 controls are open". Neither is true in this build: the only importers of `readCapabilities` are `lib/compiler-contract.ts` (which reads one word) and tests, and `brand-copy.test.ts:161` actively asserts the landing page does **not** import it. The grid is real code with no surface. Recorded, not fixed — the fix is a founder/UI decision.
- **`docs/SECURITY_BOUNDARIES.md` was stale**, as the seam map said: it forbids accepting customer document bytes while `nextjs/lib/activation-policy.ts` has had intake, CDR and GPU OCR enabled since 2026-08-29. Appended a dated current-state section under §7 R-6; the old text stays.
- **Contract §4.3's `isImmutableScopedObjectKey` interaction is worth a note, not a change.** `shared/productCoreCompileEnvelope.ts:82` requires `immutable/<tenantId>/<workspaceId>/`, while the live key layout is `immutable/<workspaceId>/<workspaceId>/` (`nextjs/lib/immutable-keys.ts`). Those agree only because `buildProductCoreV2Request` sets `tenantId: workspaceId` (`core-runtime-v2.ts:157`). The gate inherits that identity assumption; seam-map O-4 (is `workspaceId` the tenant boundary?) is still the open question, and it is lane AB's and the founder's, not F's.

## 8. Open questions for the founder

1. **Audit table.** `enterprise_audit_events` is chosen for gate events. Its `organization_id` is `NOT NULL`, so a pilot workspace with no enterprise organization row cannot record one and therefore cannot be approved. Confirm that fail-closed direction, or say gate events belong somewhere every workspace can write.
2. **`/subprocessors` omits Dropbox and Microsoft** while live connector code exists for both. A disclosure that understates who touches customer content is the defect direction that matters. Not edited here.
3. **No DPA is published.** Precondition 15 cannot close without one; its content is a legal decision.
4. **Microsoft Graph scopes** are `Files.Read.All` + `Sites.Read.All` — tenant-wide read, not least privilege for one workspace. Narrowing them changes what the connector can do.
5. **Google Drive tombstones** (`connector-oauth-adapters.ts:79`): accepted limitation, or fix before P2 connectors? Seam-map O-6, still open.
6. **Retention has no enforcement job.** Building one is a delete path and needs its own canary and its own approval.
7. **Rewrite or append in `docs/SECURITY_BOUNDARIES.md`?** I appended a dated section rather than editing statements that are now false, on the reasoning that historical text is not overwritten. Say if the stale paragraph should be struck instead.
8. **Nobody may record precondition 17.** Stated for the record: an agent will not create a founder approval receipt. A gate that can be closed by the thing it gates is not a gate.
9. **Should the receipt digest bind the subject?** Contract §4.3 defines `receiptSha256` as sha256 over the evidence list alone, so two tenants with identical evidence produce the same digest. Binding `tenantId` and `workspaceId` into it would make a stored digest non-portable between tenants, but it edits a frozen interface, which is not a lane's call. Rows are attributed by their `tenant_id`/`workspace_id` columns either way.

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

## R.6 Major, disputed on the remedy — `nextjs/app/workspace/page.tsx`

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
