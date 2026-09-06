# USKC P0 — Lane AB report (Universal Source domain)

Campaign `TAVONEL-USKC-P0-20260906-V1` · lane AB · repo `tavonel-saas-foundation`
Worktree `D:\CodexProjects\uskc-lanes\site-ab-source-domain` · base `4c18e86`

---

## 1. Branch and pushed SHA

Branch: `agent/uskc-ab-source-domain`
Pushed SHA: `30fade8ec6d8db740c2c581e512e005e339dbb61` — the commit carrying the whole lane and the
first version of this report. Writing this line down is itself a commit, so the branch head is one
commit later; the campaign's structured record carries the final SHA.

Production deploy 안 함. Git push로 Preview deployment는 자동 생성됨. The preview was **not**
verified through the Vercel MCP.

Commits (`git log --oneline origin/main..HEAD`):

```
30fade8 Report lane AB
5cb620a Add the source ledger table, store and migration 0049
6d183c0 Define Source, SourceVersion and SourceRepresentation with their invariants
8a48762 Carry the frozen USKC contract-v1 vocabularies
```

## 2. Files

Created: ten files — the nine below, all inside the lane's exclusive ownership row, plus this
report, which the campaign asks for and which is not an owned-row file. (First pass said "nine" and
listed nine; the diff has ten. Corrected.)

| File | What it is |
|---|---|
| `shared/uskcEnums.ts` | The frozen contract-v1 vocabularies, transliterated from `contract/enums.v1.json` |
| `shared/sourceDomain.ts` | The §4.1 shapes, the adapter, and the invariants as pure functions |
| `server/foundation/uskcEnums.test.ts` | Pins every list against the frozen literals |
| `server/foundation/sourceDomain.test.ts` | 21 tests, 15 of them failure paths (13 named "refuses …") — count as of repair round 2 |
| `supabase/migrations/0049_universal_source_domain.sql` | `sources`, `source_versions`, `source_representations` |
| `server/foundation/sourceDomainMigration.test.ts` | Pins the SQL, in the style of `trial-source-digest-migration.test.ts` |
| `nextjs/lib/source-domain-store.ts` | Projection (pure) + record/read through PostgREST |
| `nextjs/lib/source-domain-store.test.ts` | 21 tests, 11 of them failure paths (10 named "refuses …") — count as of repair round 3 |
| `docs/UNIVERSAL_SOURCE_DOMAIN_2026-09-06.md` | What exists, the alias rule, the backfill, the seam, what is deferred |

Modified **against `origin/main`: none** — every file above is net-new, which is why
`git diff origin/main..HEAD --stat` shows only additions. *Within the branch* the two repair passes
modified seven of them (`shared/sourceDomain.ts`, `nextjs/lib/source-domain-store.ts` and its test,
`server/foundation/sourceDomain.test.ts`, the migration header, the doc, this report); §8 and §9 say
what changed in each. The unqualified "Modified: none" the first pass wrote here was true only
against main, and a reader who stopped at this table was told something false about the branch.
Row-only edits: **none taken** — see §4.

## 3. Gates

Run from the worktree. `D:\CodexProjects\uskc-lanes\install-site-ab-source-domain.log` ends with
`exit=0`, but it installed **`nextjs/node_modules` only**; the repo root had no `node_modules`, so
`pnpm check` at the root failed with "'tsc' is not recognized". Fixed by running
`pnpm install --frozen-lockfile` at the worktree root (14m38s, exit 0, "Ignored build scripts:
@tailwindcss/oxide@4.1.14"). Reported because every other site lane will hit the same thing.

| # | Command | Exit | Output tail |
|---|---|---|---|
| 0a | `pnpm check` (root) | 0 | `> tavonel-saas-foundation@1.0.0 check` / `> tsc --noEmit` (no diagnostics) |
| 0b | `pnpm test` (root) | 0 | `Test Files 25 passed (25)` · `Tests 91 passed (91)` · `Duration 7.14s` |
| 1 | `pnpm check` (nextjs) | 0 | `> tsc --noEmit && eslint app components lib` (no diagnostics) |
| 2 | `pnpm test` (nextjs) | 0 | `Test Files 164 passed (164)` · `Tests 1594 passed (1594)` · `Duration 33.64s` |
| 3 | `pnpm build` (nextjs) | 0 | `✓ Compiled successfully in 48s` · `Generating static pages (0/69) … (69/69)` · `+ First Load JS shared by all 103 kB` |
| 4 | Playwright | — | **Skipped.** No page or route was added or changed; this lane ships types, a migration, a store module and a doc. Nothing renders. |
| 5 | `git status` | 0 | clean except the intended files; `origin/main..HEAD` = the four commits above |
| 6 | `git push -u origin agent/uskc-ab-source-domain` | 0 | new branch created on `0ssol1620-byte/tavonel-saas-foundation` |

New tests (first pass): `uskcEnums` 4, `sourceDomain` 17, `sourceDomainMigration` 8,
`source-domain-store` 15 — 44 in total, 20 of them failure paths. Zero regressions: the root suite
went from **22 test files to 25** (three added here) and nextjs from 163 to 164, with every
pre-existing test still passing. (First pass said "25 before and after … from 23"; both numbers
were wrong and mutually inconsistent. Corrected. §8 carries the repair-pass counts.)

Failure paths covered: version bound to another source · bare-hex, truncated and mismatched digests
· zero and fractional byte length · non-instant timestamp · tombstone reason with no time · original
that claims a derivation, a loss, or a digest the version does not have · derived artifact with no
parent, an absent parent, itself as parent, or a parent under another version · unrecorded provider
revision · second original · duplicate representation id · second digest for a bound version ·
object key outside the workspace in either position · store not configured · read failure · write
failure mid-chain · tombstoned source refused before any write.

## 4. What the blueprint or contract asked that I did not do, and why

- **The two permitted row-only edits were not taken.**
  `shared/tenantDomain.ts` (optional `sourceId`/`sourceVersionId` on `DocumentMetadata`):
  `documentToSource` derives both from `document.id`, so the fields would be populated by nobody.
  A field no writer sets is a schema that looks like coverage and provides none.
  `shared/productCoreFieldMap.ts` (rows for new fields): the map already carries `source.sourceId`,
  `source.sourceVersionId`, `source.contentSha256`, `source.immutableObjectKey`, `source.mimeType`
  and `source.byteLength`. The genuinely new fields (`sourceFamily`, `originKind`, the
  representation chain) have no Core counterpart at all and would all be `product_owned` rows —
  documentation with no consumer, on a file two other lanes may touch. Both are one-line additions
  if the founder or the integration wants them; say so and they go in.
- **No recording call on the live compile path.** Contract §7 R-2 defers changing the compile wire
  until lanes C and E exist. The store is complete and tested; §6 of the doc names the exact write
  point (`quarantine-sidecar/foundation-cdr-worker/src/sanitize.ts:194`) and the two values that
  path does not yet compute (the version's byte length, and the digest of `ocr.json`).
- **No `parentVersionId` population, no replace-version semantics.** Seam map O-5: every re-upload
  creates a fresh document id and quarantine key, so version lineage is net-new product behaviour
  rather than aliasing, and shipping it inside a compatibility ticket would smuggle a product
  change into a rename. Column and field exist and stay null.
- **No tombstone writer.** `assertSourceCompilable` refuses a tombstoned source and the columns
  exist; nothing yet writes one, because the deletion signal (a Drive trash, a customer request)
  is lane F and P2 connector work.
- **§48 P0-A "existing PDF/Office upload regression 0" is not verifiable locally.** Nothing in the
  upload, CDR or compile path was touched and all 1,641 pre-existing tests still pass (1,694 total
  at repair round 2, minus the 53 this lane adds: root `uskcEnums` 4 + `sourceDomain` 21 +
  `sourceDomainMigration` 8, nextjs `source-domain-store` 20 — each counted by running that file
  alone). The first pass's "1,685 total minus the 44 added here" was the count at that pass and was
  left stale by both repairs; only the 1,641 survives. That is the strongest
  statement the repository supports. Migration 0049 has not been applied anywhere — no Supabase
  CLI, no Docker, and applying it is a founder action.

## 5. Conflicts and proposed contract changes (not edits)

**C-AB-1 — RATIFIED (contract §8.1, 2026-09-06).** The orchestrator adopted the second parameter:
§4.1 now reads `documentToSource(document: DocumentMetadata, observed: SourceObservation)`, with
`SourceObservation` carrying the byte length, immutable key and timestamps the adapter may not
invent. The shipped code and the contract text agree; nothing changes in this lane. The original
reasoning is kept below as the record of why.

**C-AB-1 (as first raised) — `documentToSource`'s frozen signature cannot be honoured as written.** Contract §4.1
gives `documentToSource(document: DocumentMetadata): { source: Source; version: SourceVersion }`
and calls it "adapter, pure". `DocumentMetadata` (`shared/tenantDomain.ts:42-51`) has eight fields:
`id`, `workspaceId`, `createdBy`, `originalFilename`, `declaredMimeType`, `quarantineObjectKey`,
`state`, `sourceSha256`. It carries **no byte length, no timestamps, and no immutable object key**,
and `Source.createdAt`, `SourceVersion.byteLength` and `SourceVersion.observedAt` are all required
non-nullable. A pure function cannot produce them; an impure one would call `new Date()`, and any
other route fabricates a number. Shipped as
`documentToSource(document, observed: SourceObservation)`. **Proposed amendment:** adopt the second
parameter in §4.1. No other lane calls this function (D consumes the manifest, F consumes
`AclSnapshot`), so the blast radius is the contract text.

**C-AB-2 — `SourceRepresentation.providerId`/`providerRevision` have no honest value for an
`original`.** The frozen type requires both on every representation, but uploaded bytes were not
produced by a reader. The convention used here is that for `kind: "original"` they name the path
that *delivered* the bytes (`foundation_r2_intake_v1` / the intake-contract migration id). Lane C
owns provider identity; if it wants a different convention, this is the one place to change.

**No file conflict with another lane.** Every file created is exclusive to AB. Migration number
0049 is claimed and 0050 is left free for F.

**C-AB-3 — `shared/uskcEnums.ts` is NOT byte-identical across the three site worktrees.** The first
pass asserted it was, on the strength of contract §3 rather than a measurement. Measured
(`sha256sum`, 2026-09-06):

```
6dceb23128bb902c554006fde8255c90b2f686a3688fe1617c440084c7ac1c9f  AB/shared/uskcEnums.ts
4ba9782df0ed9a41afa2f3cb98381bbbe5e8c6b817dcb298212aa65f7b1818c7  D/shared/uskcEnums.ts
ce2cf1c43fa794cd7677048df04ea383610a302b99676b82ca265ff97ad0f90f  F/shared/uskcEnums.ts
```

Three files, three digests. The *values* agree with `contract/enums.v1.json` in all three; the
exported const names do not (AB `sourceFamilies` / `capabilityStatusesAcceptedAtUpload`; D
`SOURCE_FAMILIES` / `CAPABILITY_STATUS_ACCEPTED_AT_UPLOAD`; F `SOURCE_FAMILIES` /
`CAPABILITY_STATUSES_ACCEPTED_AT_UPLOAD`). Whichever file the integration keeps, the other two
lanes' imports break. AB is the definer, but D's and F's copies are D's and F's files and this lane
does not edit another lane's files (§1), so it is reported, not fixed. The integration merge needs
one decision — keep AB's file and rename the imports in D and F, or have AB re-export the
SCREAMING_SNAKE aliases.

**C-AB-3 — RESOLVED (contract §8.1, 2026-09-06).** The orchestrator ruled that AB's file — camelCase
exports plus `USKC_ENUMS_CONTRACT` — is the one copy, and that lanes D and F replace theirs with
AB's bytes (`git show origin/agent/uskc-ab-source-domain:shared/uskcEnums.ts`) and rewrite their
imports. AB's copy is unchanged by that ruling and stays at sha256
`6dceb23128bb902c554006fde8255c90b2f686a3688fe1617c440084c7ac1c9f`; no alias re-export is added
here, because two spellings of one frozen vocabulary is the thing the ruling removes. The
divergence therefore remains open in D's and F's worktrees until they land it, and it is not AB's
edit to make (§1).

## 6. Open questions for the founder

1. **Is `workspaceId` the tenant boundary, or is a multi-workspace tenant planned?** (seam map O-4)
   Everything shipped here sets `tenantId = workspaceId` because no other value exists anywhere in
   storage or on the wire. If a real tenant axis is coming, `sources.tenant_id` is where it lands
   and the backfill needs a source for it.
2. **Does a re-upload of the same file become a new `SourceVersion` of one `Source`?** (O-5) That
   is new product behaviour and needs a rule for "the same logical file" before any code writes
   `parentVersionId`.
3. **Is the quarantine original actually retained?** No code in this repository deletes it, but an
   R2 bucket lifecycle rule would, and that is bucket configuration nobody in this campaign can
   read. Until someone checks, "original preserved where policy allows" is unconfirmed and this
   lane says so rather than claiming it.
4. **May `nextjs/lib/source-domain-store.ts` be wired at the CDR receipt write?** That is a change
   to a deployed Cloudflare worker and to what the pipeline records for real uploads. Not an
   agent's call, and not schedulable before the two missing digests in doc §6 have producers.
5. **Which schema does the ledger belong to long-term?** It is created in `public` alongside the
   `foundation_*` tables, service-role only. The `foundation_` prefix was not used because these
   are contract-v1 names shared with the core repo, but the naming is worth one decision.
6. **`documentToSource`'s second parameter** (C-AB-1) — accept the amendment, or specify a
   different split.

## 7. Contradictions found on disk

Confirmed, with paths:

- **Seam map C-1 confirmed.** No `document_versions` table exists in any of the 48 base migrations.
  §25's `document_version_id → source_version_id` migration line has no left-hand side.
- **Seam map C-2 confirmed.** `nextjs/lib/immutable-keys.ts:9` builds
  `immutable/${workspaceId}/${workspaceId}/`. The compile envelope's own check expects
  `immutable/${tenantId}/${workspaceId}/` (`shared/productCoreCompileEnvelope.ts:85`) and the live
  builder satisfies it by passing the workspace id as both
  (`nextjs/lib/core-runtime-v2.ts:156-157`). There is no tenant segment.
- **Seam map C-4 confirmed.** `nextjs/lib/collection-compiler.ts:284` asserts
  `input.sourceImmutableKey !== input.sanitizedKey` → reject. The recorded "original" is the CDR
  output. Not touched; recorded as a fact in the doc, and this ledger models the chain correctly
  beside it (version = uploaded bytes, sanitized PDF = a `normalized` representation).

Contradicting a statement in the contract or the seam map:

- **Contract §4.1 says the backfill comes from `documents` / `sanitization_proofs`. Those are not
  live tables.** `supabase/migrations/0001_tavonel_tenant_foundation.sql:1` says "This migration is
  intentionally not applied by this project", and the only references to either table anywhere in
  the repository are two migration-pinning tests
  (`server/foundation/supabaseMigration.test.ts:21-22`, `server/foundation/rlsMatrixContract.test.ts:15-16`).
  The live intake ledger is `foundation_intake_admissions` (migrations `0008`, `0048`), keyed by a
  `pilot-…` workspace key rather than a workspace uuid. The backfill is written and guarded by
  `to_regclass('public.documents')`, so it is correct where 0001 was applied and a no-op — not an
  error — where it was not.
- **Contract §4.1's `sanitizerVersion` for the `normalized` representation is not in the CDR
  receipt.** `tavonel.cdr_receipt.v1` (`quarantine-sidecar/foundation-cdr-worker/src/sanitize.ts:195-206`)
  writes `provider: env.TAVONEL_CDR_PROVIDER` and no separate version field.
  `SanitizationProofMetadata.sanitizerVersion` (`shared/tenantDomain.ts:59`) belongs to the
  not-applied 0001 schema. Today one string has to serve as both `providerId` and
  `providerRevision`, or the CDR worker gains a field.
- **Seam map C-4's remedy is not this lane's.** The seam map calls fixing the
  `sourceImmutableKey === sanitizedKey` assertion "the substance of the lane"; contract §7 R-2
  overrides that and the contract wins. Recorded here so the difference is not read as an omission.
- **The install log's `exit=0` does not mean the worktree is installable.** `install-site-*.log`
  covers `nextjs/` only, and gate 0 needs root `node_modules`. See §3.

---

## 8. Repair pass (2026-09-06)

Two adversarial reviewers examined the branch. Every confirmed blocker and major below was real; all
are fixed, each with the failure-path test that would have caught it. Nothing was widened beyond the
findings.

### 8.1 Blocker — a stored representation could disagree and still be reported "recorded"

`recordSourceLedger` read `source_versions` before writing and nothing else. `Prefer:
resolution=ignore-duplicates` makes PostgREST keep the stored row and answer `201`, so a derived
artifact re-presented at a **different digest** under the same `representationId` was answered
`{ok: true, value: "recorded"}` while the stored row said something else — and no database trigger
could catch it, because both immutability triggers are `BEFORE UPDATE` and this path only inserts.
The same hole existed on `sources` (a re-claim of a `sourceId` for a different `tenantId`,
`workspaceId`, `sourceFamily` or `createdAt`) — the second confirmed major.

Fixed once, where both go through: `insertVerified(table, keyColumn, row)`
(`nextjs/lib/source-domain-store.ts`) posts with `return=representation`, and when nothing comes
back — the row was kept, not inserted — reads the kept row and compares it column by column.
A disagreement is the new `SOURCE_DOMAIN_STORE_CONFLICT`, never a success. Timestamps are compared
as instants, because PostgREST returns a `timestamptz` normalised to `+00:00` and a string
comparison would refuse a legitimate redelivery.

This also closes the concurrency window the migration header claimed the database covered: two
writers presenting the same version at once no longer produce a silent success for the loser. The
migration's header comment overstated what the triggers do (`BEFORE UPDATE` only) and now says
what they actually cover — reviewer contradiction, corrected in the SQL.

Consequence stated plainly: a conflict found on a representation can leave the `sources` and
`source_versions` rows durable. Both were compared against what is stored and agreed with it, so
nothing wrong was written; the chain is left incomplete, which is what a refused write should leave.

Tests (`nextjs/lib/source-domain-store.test.ts`): a derived artifact stored under another digest is
refused and the read-back is asserted to have happened; a source id stored for another tenant is
refused and **no** `source_versions` write follows; a redelivery whose stored rows agree — including
`+00:00` vs `Z` timestamps — is still `recorded`.

### 8.2 Major — a prototype key escaped the fail-closed MIME default

`sourceFamilyForMimeType` indexed an object literal, so the MIME type `__proto__` returned
`Object.prototype` and `constructor` returned a function; neither is a `SourceFamily`, and `??` can
never fire on them. The value flowed into `Source.sourceFamily`, past `validateSourceLedger`, and
would have been caught only by a check constraint in a migration that is not applied anywhere.
Fixed by holding the table in a `Map`, where those are keys like any other. Test: every prototype
key answers `unknown`.

### 8.3 Major — a lineage cycle validated as a whole chain

`validateSourceLedger` checked each parent one hop: exists, same `sourceVersionId`, not itself. Two
representations naming each other satisfied all three with no `original` anywhere — a provenance
rooted in itself, certified valid by the lane's own fail-closed checker, and refused only later by
the database trigger, after `sources` and `source_versions` were already durable. Now the chain must
reduce to a root: mark the roots, repeatedly mark whoever's parents are all marked, refuse anything
still unmarked. `projectSourceLedger` gained the same property for free by emitting representations
in **topological** order instead of a fixed list of kinds — which also fixes the reviewer's other
contradiction, that "parents are inserted before children" held only for chains that happened to run
in the listed order (an `ocr → visual` chain was emitted child-first). `REPRESENTATION_ORDER` is
gone. Tests: a two-node cycle, a derived artifact hanging off one, the same chain rooted in the
original still valid, a projected cycle refused, and `ocr → visual` emitted parent-first.

### 8.4 Major — the doc omitted text §4.1 orders it to carry

Contract §4.1 ends "Say exactly this in `docs/UNIVERSAL_SOURCE_DOMAIN_2026-09-06.md`". The
founder-resolved B-2 / B-1 paragraph was not there in any form. It is now the first thing in §3 of
that doc, word for word. The section's own `tenantId = workspaceId` bullet, which stated the
opposite emphasis to B-2, was rewritten to say what it actually means: two columns and two fields,
carrying one value today because the live layout has no second axis to read — a fact about storage,
not a rule that tenant is the workspace.

### 8.5 Contradicted claim — `SOURCE_TIMESTAMP_INVALID` did not refuse a fake instant

The reviewer is right and the first pass's failure-path list was wrong: `2026-13-45T99:99:99Z`
matched the shape pattern and validated. `Date.parse` alone is not enough either — `2026-02-30`
parses silently as 2 March, which would store a date nobody observed. `isInstant` now requires the
pattern, a parse, and that the parsed date spells its own day back. Tests cover month 13 / day 45 /
hour 99, 30 February, hour 24, and month 00 on a tombstone.

### 8.6 Findings answered without a code change

- **`documentToSource`'s second parameter** (major, both reviewers) — the reviewers verified the
  reasoning and rate it a contract-text change the orchestrator must ratify, not a lane defect.
  C-AB-1 in §5 stands unchanged; no other lane calls the function.
- **`shared/uskcEnums.ts` diverges across worktrees** (major) — measured, confirmed, and now C-AB-3
  in §5. D's and F's copies belong to D and F; §1 forbids editing them, so this lane reports it.
- **`pnpm build` not reproduced by a reviewer** — it is green here, three times, most recently with
  the exit code captured (§8.7). Worth one clean-CI run rather than trust in either machine.
- **Pushed-SHA drift in §1** — the report is committed after the code it describes, so the SHA in §1
  is always one commit behind. The structured record carries the final SHA.

### 8.7 Gates, rerun after the repair

| # | Command | Exit | Output tail |
|---|---|---|---|
| 0a | `pnpm check` (root) | 0 | `> tavonel-saas-foundation@1.0.0 check` / `> tsc --noEmit` (no diagnostics) |
| 0b | `pnpm test` (root) | 0 | `Test Files 25 passed (25)` · `Tests 93 passed (93)` · `Duration 2.64s` |
| 1 | `pnpm check` (nextjs) | 0 | `> tsc --noEmit && eslint app components lib` (no diagnostics) |
| 2 | `pnpm test` (nextjs) | 0 | `Test Files 164 passed (164)` · `Tests 1599 passed (1599)` · `Duration 16.13s` |
| 3 | `pnpm build` (nextjs) | 0 | `EXIT=0` · `✓ Compiled successfully in 12.9s` · `✓ Generating static pages (69/69)` · `+ First Load JS shared by all 103 kB` |
| 4 | Playwright | — | **Skipped**, same reason: no page or route added or changed. Nothing this lane ships renders. |
| 5 | `git status --short` | 0 | clean except the intended files |
| 6 | `git push -u origin agent/uskc-ab-source-domain` | 0 | `d1db946..f178836` — `f178836` carries the whole repair (code, tests, doc, §8). Recording that SHA is this line, so the branch head is one commit later again; the structured record carries the final one. Production deploy 안 함. Git push로 Preview deployment는 자동 생성됨 (not verified through the Vercel MCP). |

Counts moved by the repair: root 91 → 93 tests (three new assertions grouped into the existing
timestamp test, plus the prototype-key and cycle tests), nextjs 1,594 → 1,599 (five new store
tests). No pre-existing test was changed to make anything pass; the two store mocks that returned a
bodyless `201` now return the inserted rows, which is what PostgREST does with
`return=representation`.

---

## 9. Repair round 2 (2026-09-06)

The findings in `REPAIR2_FINDINGS_2026-09-06.json` under key `AB`, each closed as contract §8.1
rules it. Two majors were code; one major was a doc retraction; two majors were closed by the
orchestrator's own rulings and needed no edit here. Every contradicted report claim below is
corrected in place, above, rather than only argued about here.

### 9.1 Major — the frozen vocabularies were never consulted at run time

`validateSourceLedger` type-checked and nothing more: a `Source` with `originKind`
`"smuggled_origin"` and `sourceFamily` `"not_a_family"`, and a `SourceRepresentation` with `kind`
`"smuggled_kind"`, all returned `{valid: true}`. The unions in `shared/uskcEnums.ts` are a
compile-time artifact, and contract §4.1 names PostgREST rows, other lanes and the Python core as
consumers — every one of them reaches this module across a JSON boundary where a family is whatever
string was stored. §8.1 (*AB validator*): "runtime membership checks against the frozen vocabularies
… are required — the enums exist to be consulted."

Fixed in `shared/sourceDomain.ts`: `sourceOriginKinds` is now a runtime tuple (the frozen
`enums.v1.json` has no `OriginKind` list, so it is spelled here exactly as §4.1 spells the union,
and the frozen file is not edited), and `checkSource` / `checkRepresentations` test membership in
three `Set`s built from `sourceOriginKinds`, `sourceFamilies` and `representationKinds`. The new
code is `SOURCE_VOCABULARY_INVALID`; `SourceLedgerProjectionFailure` in the store already widens
with `SourceLedgerViolation`, so the store surfaces it with no change.

Test (`server/foundation/sourceDomain.test.ts`, "refuses a value outside the frozen vocabularies"):
a smuggled origin kind, a smuggled family, a smuggled representation kind, and `"constructor"` as a
family — the last because a prototype member is a string like any other here, not a member of
anything. Each asserts `SOURCE_VOCABULARY_INVALID`, and the representation case is discriminating:
before the fix it was refused as `REPRESENTATION_LINEAGE_BROKEN`, for the wrong reason.

### 9.2 Major — `sourceModifiedAt` was the one timestamp nothing checked

`checkVersion` validated `observedAt` and `parentVersionId`; `checkSource` validated `createdAt` and
`tombstonedAt`; `SourceVersion.sourceModifiedAt` was validated nowhere, so
`"2026-13-45T99:99:99Z"` — the exact string §8.5 says `isInstant` now refuses — passed
`validateSourceLedger` and `recordSourceLedger` wrote it (`source-domain-store.ts:366`) into a
`timestamptz` column. Fixed with the same `isInstant` the other four fields use.

Test: "refuses a sourceModifiedAt that is not an instant" — garbage, an instant-shaped non-instant,
and a real instant that must still validate.

**§8.5's scope claim is corrected by this.** "`isInstant` now requires the pattern, a parse, and that
the parsed date spells its own day back" was true of the predicate and oversold as coverage: the
failure path *"an instant-shaped string that is not an instant"* did not hold for every timestamp
field in the frozen §4.1 shapes until this round. It does now — `createdAt`, `tombstonedAt`,
`observedAt`, `sourceModifiedAt` and a representation's `createdAt` are all checked.

**§8.2's framing is corrected too.** Holding the MIME table in a `Map` closed prototype keys, but the
stated consequence — "the value flowed into `Source.sourceFamily`, past `validateSourceLedger`" —
stayed true for any non-prototype garbage until §9.1. The `Map` was the narrow half of that fix; the
membership check is the rest of it.

### 9.3 Major — the doc still carried the retracted trigger overclaim

`docs/UNIVERSAL_SOURCE_DOMAIN_2026-09-06.md:150-151` still said "Three triggers make the invariants
real under concurrency, because at-least-once delivery means two writers can present the same
version at once and only the database sees both" — the identical sentence §8.1 of this report claims
was retracted. The first repair corrected the **SQL header only**; the founder-facing deliverable,
which is the one a reader reads, was left standing. The reviewer is right, and §8.1's wording
("corrected in the SQL") described a narrower act than the claim it retracted.

The doc now says what is true: the concurrency guarantee comes from the primary keys and the partial
unique index on `kind = 'original'` plus the store's read-back (`SOURCE_DOMAIN_STORE_CONFLICT`); two
of the three triggers are `BEFORE UPDATE` and never fire on the insert-only write path; only
`source_representations_lineage_resolves` fires there. Each trigger is listed with what it covers,
and the retracted sentence is named as retracted rather than silently deleted.

### 9.4 Majors closed by §8.1 without a code change

- **`documentToSource`'s two-parameter signature** — ratified as C-AB-1. §4.1 now carries the second
  parameter; the code and the contract text agree. §5 rewritten.
- **`shared/uskcEnums.ts` differs across the three site worktrees** — §8.1 (*C-AB-3*) makes AB's file
  the one copy and puts the replacement in D's and F's hands. AB's copy is unchanged, still sha256
  `6dceb231…`, and still equals `contract/enums.v1.json` value-for-value. AB does not add
  SCREAMING_SNAKE aliases: two spellings of one frozen vocabulary is exactly what the ruling removes.
  It stays a cross-lane item, not an AB defect. §5 updated.

### 9.5 Report claims the reviewer contradicted, and what they now say

| Claim (first/repair pass) | Status | Where corrected |
|---|---|---|
| §8.1 "corrected in the SQL" implied the retraction was complete | **Contradicted, true only of the SQL** | §9.3; doc rewritten |
| §2 "`sourceDomain.test.ts` — 17 tests, 11 refusals" | **Stale** (21 tests, 15 failure paths) | §2 table |
| §2 "`source-domain-store.test.ts` — 15 tests, 9 refusals" | **Stale** (20 tests, 10 failure paths) | §2 table |
| §4 "1,641 pre-existing … 1,685 total minus the 44 added" | **Partly stale**: 1,641 survives; the totals are 1,694 and 53 | §4 |
| §2 "Modified: **none.**" | **False without its qualifier** — true against `origin/main`, false within the branch | §2 |
| §8.5 "isInstant … " read as full timestamp coverage | **Oversold until this round** | §9.2 |
| §8.2 "the value flowed … past `validateSourceLedger`" | **Still true after §8.2's fix**, for non-prototype values | §9.2 |
| §3 / §8.7 `pnpm build` exit 0, "a reviewer could not reproduce it" | **Confirmed true**: this round's reviewer reproduced exit 0, 69/69 static pages, and so did this run | §9.6 gate 3 |

Nothing in the findings file was disputed: every AB finding reproduced, and the two that §8.1 closes
are closed by ruling rather than by a probe of mine.

### 9.6 Gates, rerun after repair round 2

All from `D:\CodexProjects\uskc-lanes\site-ab-source-domain`; nextjs gates from `nextjs/`.

| # | Command | Exit | Output tail |
|---|---|---|---|
| 0a | `pnpm check` (root) | 0 | `> tavonel-saas-foundation@1.0.0 check` / `> tsc --noEmit` — no diagnostics |
| 0b | `pnpm test` (root) | 0 | `Test Files 25 passed (25)` · `Tests 95 passed (95)` · `Duration 2.75s` |
| 1 | `pnpm check` (nextjs) | 0 | `> tsc --noEmit && eslint app components lib` — no diagnostics |
| 2 | `pnpm test` (nextjs) | 0 | `Test Files 164 passed (164)` · `Tests 1599 passed (1599)` · `Duration 17.44s` |
| 3 | `pnpm build` (nextjs) | 0 | `Test Files 164 passed (164)` · `Tests 1599 passed (1599)` (the `prebuild` gate) · `✓ Compiled successfully in 13.6s` · `✓ Generating static pages (69/69)` · `+ First Load JS shared by all 103 kB` |
| 4 | Playwright | — | **Skipped, unchanged reason.** This lane adds no page and no route; `git diff origin/main..HEAD --name-only` contains no file under `nextjs/app/**` or `nextjs/components/**`, so no Playwright project has anything of this lane's to exercise. (The mobile-menu link-count spec belongs to lane D's `PRIMARY_NAV` row, not to AB.) |
| 5 | `git status --short` | 0 | clean except the intended files |
| 6 | `git push origin agent/uskc-ab-source-domain` | 0 | see §9.7 |

Counts moved by this round: root 93 → 95 tests (the two new refusal tests), nextjs unchanged at
1,599 (no store behaviour changed). No pre-existing test was edited.

### 9.7 Push

Production deploy 안 함. Git push로 Preview deployment는 자동 생성됨 — not verified through the
Vercel MCP. The pushed SHA is recorded in the campaign's structured record; as in both earlier
passes, writing it into this file would itself be a later commit.

---

## 10. Repair round 3 (2026-09-06, final)

Two items, both from contract §8.2 ("AB — one write path"). Both closed. Nothing was disputed.

### 10.1 Major — `recordSourceLedger` skipped the workspace-scope check

`projectSourceLedger` refused an object key outside the workspace (the version key and every
representation key); `recordSourceLedger` did not run that check at all. Structural validation
(`validateSourceLedger`) cannot see it — it knows an object key is a non-empty string and nothing
about the R2 layout — so a ledger that reached the store by any path other than projection (an
adapter's rows, a replayed observation, a future caller) could carry a version or representation key
pointing into **another workspace's** immutable prefix, have it written, and be answered
`{ ok: true, value: "recorded" }`. A cross-tenant pointer stored under this workspace's audit trail,
reported as success.

Fixed as §8.2 requires: one validator, both entry points.

```ts
export function ledgerObjectKeyOutOfScope(ledger: SourceLedger): string | null
```

returns the first key that is not inside the ledger's own workspace, or `null`. It reads
`ledger.source.workspaceId` and `ledger.source.sourceId` — the document id in this campaign, because
`legacyDocumentIdToSourceId` is the identity function; the comment says so, and that function and
this line change together when it stops being true. `projectSourceLedger` no longer carries its two
inline checks (`:147`, `:156` before this round) and calls the validator on the assembled ledger;
`recordSourceLedger` calls the same function after `assertSourceCompilable` and **before the first
request**, so an out-of-scope ledger costs no read and no write.

Failure-path test (`nextjs/lib/source-domain-store.test.ts`): "refuses an object key outside the
workspace in either position, before any request" — a representation key moved to
`immutable/other-workspace/other-workspace/…`, then a version key moved to
`quarantine/other-workspace/…`, both refused with `REPRESENTATION_OBJECT_KEY_OUT_OF_SCOPE`, and
`expect(calls).toEqual([])` proving no fetch was made. Verified to fail without the guard: with the
`recordSourceLedger` check removed it reports `SOURCE_DOMAIN_STORE_WRITE_FAILED` at line 260 (the
stub's empty-array answer), i.e. it had already started writing.

The projection's ordering moved slightly and is stated rather than hidden: the scope check now runs
after the lineage/topological pass instead of before it, so an observation that is *both*
out-of-scope and lineage-broken now reports `REPRESENTATION_LINEAGE_BROKEN`. Both codes are refusals,
no ledger changes class, and the existing "refuses an object key outside the workspace, in either
position" projection test is unchanged and green.

Commit `e9293ca`.

### 10.2 Major — the doc did not name the record for the tenant/workspace conflation

`docs/UNIVERSAL_SOURCE_DOMAIN_2026-09-06.md` §3 ("Two fields, one value today") said a tenant axis
would land in `tenant_id` without naming where that decision gets made. It now names it:
**ADR-008 (working title: v2 object-key layout)** — the record that decides where a tenant segment
goes in the object key and what that does to `immutable-keys.ts` — and states that until it is
written the two values coincide and neither is derived from the other in code (RESOLVED B-2,
contract §8.1). Wording is §8.2's, verbatim for the ADR name.

Commit `60133f1`.

### 10.3 Gates, rerun after repair round 3

All from `D:\CodexProjects\uskc-lanes\site-ab-source-domain`; nextjs gates from `nextjs/`.

| # | Command | Exit | Output tail |
|---|---|---|---|
| 0a | `pnpm check` (root) | 0 | `> tavonel-saas-foundation@1.0.0 check` / `> tsc --noEmit` — no diagnostics |
| 0b | `pnpm test` (root) | 0 | `Test Files 25 passed (25)` · `Tests 95 passed (95)` · `Duration 3.19s` |
| 1 | `pnpm check` (nextjs) | 0 | `> tsc --noEmit && eslint app components lib` — no diagnostics |
| 2 | `pnpm test` (nextjs) | 0 | `Test Files 164 passed (164)` · `Tests 1600 passed (1600)` · `Duration 17.69s` |
| 3 | `pnpm build` (nextjs) | 0 | `Test Files 164 passed (164)` · `Tests 1600 passed (1600)` (the `prebuild` gate) · `✓ Compiled successfully in 31.0s` · `✓ Generating static pages (69/69)` · `+ First Load JS shared by all 103 kB` |
| 4 | Playwright | — | **Skipped, unchanged reason.** No page, route, component or style is touched by this round or by this lane at all; `git diff origin/main..HEAD --name-only` still contains no file under `nextjs/app/**` or `nextjs/components/**`. |
| 5 | `git status --short` | 0 | clean except the intended files |
| 6 | `git push origin agent/uskc-ab-source-domain` | 0 | see §10.4 |

Counts moved by this round: nextjs 1,599 → 1,600 (the one new refusal test); root unchanged at 95
(no `shared/*` behaviour changed). `source-domain-store.test.ts` is 21 tests, 11 failure paths — §2's
row is updated to match rather than left stale. No pre-existing test was edited to make anything pass.

### 10.4 Push

Production deploy 안 함. Git push로 Preview deployment는 자동 생성됨 — not verified through the
Vercel MCP. The pushed SHA is in the campaign's structured record; as in every earlier pass, the
commit that carries this section is itself the last one, so the branch head is one commit past the
SHA any line inside this file could name.
