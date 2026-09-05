# USKC P0 — Lane AB report (Universal Source domain)

Campaign `TAVONEL-USKC-P0-20260906-V1` · lane AB · repo `tavonel-saas-foundation`
Worktree `D:\CodexProjects\uskc-lanes\site-ab-source-domain` · base `4c18e86`

---

## 1. Branch and pushed SHA

Branch: `agent/uskc-ab-source-domain`
Pushed SHA: `9c8f7a1a55a03cbe14a04d0e73b21e2b8d54b52e`

Production deploy 안 함. Git push로 Preview deployment는 자동 생성됨. The preview was **not**
verified through the Vercel MCP.

Commits (`git log --oneline origin/main..HEAD`):

```
9c8f7a1 Report lane AB
5cb620a Add the source ledger table, store and migration 0049
6d183c0 Define Source, SourceVersion and SourceRepresentation with their invariants
8a48762 Carry the frozen USKC contract-v1 vocabularies
```

## 2. Files

Created (all nine are inside the lane's exclusive ownership row):

| File | What it is |
|---|---|
| `shared/uskcEnums.ts` | The frozen contract-v1 vocabularies, transliterated from `contract/enums.v1.json` |
| `shared/sourceDomain.ts` | The §4.1 shapes, the adapter, and the invariants as pure functions |
| `server/foundation/uskcEnums.test.ts` | Pins every list against the frozen literals |
| `server/foundation/sourceDomain.test.ts` | 17 tests, of which 11 are refusals |
| `supabase/migrations/0049_universal_source_domain.sql` | `sources`, `source_versions`, `source_representations` |
| `server/foundation/sourceDomainMigration.test.ts` | Pins the SQL, in the style of `trial-source-digest-migration.test.ts` |
| `nextjs/lib/source-domain-store.ts` | Projection (pure) + record/read through PostgREST |
| `nextjs/lib/source-domain-store.test.ts` | 15 tests, of which 9 are refusals |
| `docs/UNIVERSAL_SOURCE_DOMAIN_2026-09-06.md` | What exists, the alias rule, the backfill, the seam, what is deferred |

Modified: **none.** Row-only edits: **none taken** — see §4.

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

New tests: `uskcEnums` 4, `sourceDomain` 17, `sourceDomainMigration` 8, `source-domain-store` 15 —
44 in total, 20 of them failure paths. Zero regressions: root was 25/25 files before and after
(the two new root files raise the count from 23), nextjs 1,594 passing.

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
  upload, CDR or compile path was touched and all 1,685 existing tests pass, which is the strongest
  statement the repository supports. Migration 0049 has not been applied anywhere — no Supabase
  CLI, no Docker, and applying it is a founder action.

## 5. Conflicts and proposed contract changes (not edits)

**C-AB-1 — `documentToSource`'s frozen signature cannot be honoured as written.** Contract §4.1
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

**No file conflict with another lane.** Every file created is exclusive to AB. `shared/uskcEnums.ts`
is defined here; D and F carry byte-identical copies per §3 and the integration keeps one.
Migration number 0049 is claimed and 0050 is left free for F.

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
