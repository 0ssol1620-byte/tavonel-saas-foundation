# Universal Source Domain — Source / SourceVersion / SourceRepresentation

Date: 2026-09-06 · Campaign `TAVONEL-USKC-P0-20260906-V1`, lane AB · Branch `agent/uskc-ab-source-domain`
Authority: `USKC_LANE_CONTRACT_2026-09-06.md` §4.1 and §5 AB; blueprint §3, §6, §7, §25, §48 P0-A/P0-B, §62 steps 1–2.

This lane adds a ledger. It changes no worker, no object key, no compile request and no existing
table. Everything below is either what the code does today (with the path) or what the new files
do; nothing here is a claim about a system that has run.

---

## 1. What exists today

The live intake and compile path, verified in this worktree at `4c18e86`:

| Stage | Where the bytes go | What records it |
|---|---|---|
| Upload | `quarantine/<workspace_key>/<document_id>/source` | `foundation_intake_admissions` (migration `0008`, `0048`), `requested_bytes` and `declared_mime_type` |
| CDR | `immutable/<ws>/<ws>/<doc>/<outputSha256>/sanitized.pdf` | `.../cdr-receipt.json`, schema `tavonel.cdr_receipt.v1` (`quarantine-sidecar/foundation-cdr-worker/src/sanitize.ts:194-206`) |
| OCR | `.../ocr.json` (`tavonel.ocr_result.v2`) | the object itself; `inputSha256` inside it binds back to the sanitized PDF |
| Compile | `.../collections/<id>/<digest>/candidate-world.json` | the artifact; `foundation_compile_jobs` carries the job lifecycle |

Three facts bind every design decision in this lane.

**There is no tenant segment anywhere.** `immutableWorkspacePrefix` builds
`immutable/${workspaceId}/${workspaceId}/` — the same workspace id twice
(`nextjs/lib/immutable-keys.ts:9`), and the compile envelope's own key check expects
`immutable/${tenantId}/${workspaceId}/` (`shared/productCoreCompileEnvelope.ts:85`), which the live
builder satisfies by passing the workspace id as both (`nextjs/lib/core-runtime-v2.ts:156-157`).
The workspace is the tenancy boundary in code. `Source.tenantId` carries the same value, and says
so rather than pretending to a second axis that has no storage anywhere.

**`documents` and `sanitization_proofs` are not the live tables.** Migration `0001` declares itself
"intentionally not applied by this project" (its own first line), and no application module reads
either table — the only references in the repository are two migration-pinning tests
(`server/foundation/supabaseMigration.test.ts:21`, `server/foundation/rlsMatrixContract.test.ts:15`).
The live intake ledger is `foundation_intake_admissions`, keyed by a `pilot-…` workspace key and a
document uuid.

**Nothing durable records a representation chain.** `runCollectionCompile`
(`nextjs/lib/collection-compile-run.ts`) reads the R2 listing, groups keys by suffix
(`groupImmutableDocuments`), compiles, and writes an R2 artifact. The only database write in that
flow is the compile job row, through a security-definer RPC that knows nothing about sources. So
"every derived artifact has sourceVersion + parent digest" (§48 P0-B) has nowhere to be true yet.
That is what migration `0049` and `nextjs/lib/source-domain-store.ts` are for.

---

## 2. The three records

`shared/sourceDomain.ts` carries the frozen §4.1 shapes and the invariants, as pure functions.
`shared/uskcEnums.ts` carries the frozen contract-v1 vocabularies (`SourceFamily`,
`RepresentationKind`, and the rest), transliterated from `contract/enums.v1.json` and pinned by
`server/foundation/uskcEnums.test.ts`.

Invariants, each with a failing test in `server/foundation/sourceDomain.test.ts` and, where two
writers can race, an enforcement in SQL:

| Invariant | Code | TypeScript | SQL |
|---|---|---|---|
| One digest and one object key per source version, for ever | `SOURCE_VERSION_DIGEST_CONFLICT` | `validateSourceVersionRebinding` | trigger `source_versions_digest_immutable` |
| `original` has no derivation and loses nothing | `REPRESENTATION_LINEAGE_BROKEN` | `validateSourceLedger` | `check ((kind = 'original') = (cardinality(derived_from) = 0))`, `check (kind <> 'original' or lossy = false)` |
| The original is the version's own bytes | `SOURCE_VERSION_DIGEST_CONFLICT` | `validateSourceLedger` | — (the store refuses before the write) |
| A derived artifact names parents that exist under the same version, and the chain reduces to a root rather than to itself | `REPRESENTATION_LINEAGE_BROKEN` | `validateSourceLedger` | trigger `source_representations_lineage_resolves` |
| The original's key and digest are never rewritten | `ORIGINAL_IMMUTABLE` | `validateRepresentationRewrite` | trigger `source_representations_original_immutable`, unique partial index on `kind = 'original'` |
| A tombstoned source is readable for audit and never compiled | `SOURCE_TOMBSTONED` | `assertSourceCompilable` | — (a read-time question, not a write constraint) |
| A representation without a producing revision is refused | `REPRESENTATION_LINEAGE_BROKEN` | `validateSourceLedger` | `provider_revision text not null` |
| `originKind`, `sourceFamily` and a representation `kind` are members of the frozen vocabularies | `SOURCE_VOCABULARY_INVALID` | `validateSourceLedger` | `check (… in (…))` on each column |
| Every timestamp field — `createdAt`, `tombstonedAt`, `observedAt`, `sourceModifiedAt`, a representation's `createdAt` — is a real instant | `SOURCE_TIMESTAMP_INVALID` | `validateSourceLedger` | `timestamptz not null` |

The vocabularies are consulted at run time and not only by the compiler: `validateSourceLedger` is
reached across JSON boundaries — a PostgREST row, another lane, the Python core (contract §4.1) —
where the TypeScript unions are gone and a family is whatever string was stored. A value no reader
has been qualified for is refused there, not admitted into the ledger vocabulary.

The last one is the rule that keeps this ledger honest: an artifact whose producing revision is
unknown cannot be reproduced, so there is no default value for it. A caller that does not know the
revision does not record the representation.

---

## 3. Interim identity rules (reversible; founder list)

**Founder-resolved (2026-09-06):** `tenantId` and `workspaceId` are distinct concepts (Tenant =
organization / security / billing / policy; Workspace = working knowledge boundary) — keep two
columns and two fields, never derive one from the other in code, even though today's object keys
carry only the workspace (RESOLVED B-2). The `sourceId = documents.id`, one-version-per-row rule is
a **compatibility shim** (status `IMPLEMENTED_NOT_MERGED`, shim), not canonical semantics; P1-A
builds real lineage from connector stable ids / canonical URIs / explicit replace operations, and
**a filename alone never identifies the same Source** (RESOLVED B-1).

That paragraph is the contract's (§4.1), carried here word for word. Everything in this section is
the shim it describes: decisions this campaign takes so that the ledger can exist. Each is
reversible and each is listed for the founder in the lane report.

- **`sourceId = documents.id`.** `legacyDocumentIdToSourceId` is the identity function and the one
  place that changes when a logical source outlives a file replacement. §48 P0-A's "old document
  IDs resolve through adapter" is satisfied by identity, not by a lookup table.
- **One `SourceVersion` per document, `parentVersionId` always absent.** Every re-upload creates a
  new document id and a new quarantine key; nothing in the code can say that two uploads are two
  versions of one logical source. Version lineage is net-new product behaviour, not a rename, and
  it is not smuggled in here. The column and the field exist and stay null.
- **`sourceVersionId = "<sourceId>:<digest hex>"`.** The same pairing `groupImmutableDocuments`
  already uses to identify a document's bytes, spelled with a separator the compile envelope's
  identifier pattern accepts. Deterministic, so an at-least-once redelivery recomputes it.
- **`representationId = "rep-" + sha256(sourceVersionId \n kind \n objectKey)[0:32]`.** Also
  deterministic, for the same reason.
- **Two fields, one value today.** `sources.tenant_id` and `sources.workspace_id` are two columns
  and `Source.tenantId` / `Source.workspaceId` are two fields, per B-2 above. Today's writer puts
  the same value in both because §1's live layout carries no second axis to read — that is what the
  storage says now, not a rule that tenant is the workspace. When a tenant axis exists, `tenant_id`
  is where it lands and no code has to be un-derived first. Separating the two in the object key is
  the first item of **ADR-008 (working title: v2 object-key layout)** — the record that decides
  where a tenant segment goes and what it does to `immutable-keys.ts`. Until that ADR is written the
  two values coincide, and neither is derived from the other in code (RESOLVED B-2, contract §8.1).

---

## 4. What the version is, and what C-4 actually says

The seam map's C-4 records that `nextjs/lib/collection-compiler.ts:284` asserts
`sourceImmutableKey === sanitizedKey`: the object the compile path calls the "source immutable
key" **is** the CDR output. That assertion is a live invariant and this lane does not touch it
(contract §7 R-2).

This ledger records the chain the way it happened rather than the way the compile wire names it:

```
SourceVersion            quarantine/<ws>/<doc>/source        contentSha256 = the uploaded bytes
 └─ original             same object                          lossy false, derivedFrom []
     └─ normalized       .../<outputSha256>/sanitized.pdf     lossy true,  cdr_sanitizer_v1
         └─ ocr          .../<outputSha256>/ocr.json          lossy true,  foundation_ocr_gpu_v1
```

So the version's digest is the **pre-CDR** digest and the sanitized PDF is a derived, lossy
artifact — which is what it is. The compile path's `versionKey` is not the `sourceVersionId`; it is
the `normalized` representation's digest. Both are recorded, and either can be looked up.

**Is the original retained?** No code in this repository deletes a quarantine object. The CDR
worker writes the immutable PDF and its receipt and deletes nothing —
`quarantine-sidecar/foundation-cdr-worker/src/sanitize.test.ts:166` asserts
`r2.deleted.length === 0`. Whether an R2 bucket lifecycle rule expires the quarantine prefix is
infrastructure configuration and cannot be verified from the repository; until someone reads the
bucket policy, "original preserved where policy allows" is **unconfirmed**, not a claim.

---

## 5. Migration 0049

`supabase/migrations/0049_universal_source_domain.sql` creates `sources`, `source_versions` and
`source_representations`, and nothing else. It alters no existing table, drops nothing, and is
pinned by `server/foundation/sourceDomainMigration.test.ts`.

Access follows the pattern of `0020_retrieval_foundation.sql` and the hardening in `0043`: RLS
enabled, everything revoked from `public`, `anon` and `authenticated`, `select, insert, update`
granted to `service_role` only. **There is no `delete` grant.** A source leaves service by being
tombstoned; deleting a row here deletes the record that a compile ever read those bytes, which is
the "historical evidence overwritten" stop-the-line condition.

What the database contributes under concurrency — at-least-once delivery means two writers can
present the same version at once — is the **keys**, not the triggers: the primary keys and the
partial unique index on `kind = 'original'` keep whichever row was written first, and
`nextjs/lib/source-domain-store.ts` reads that kept row back and refuses
(`SOURCE_DOMAIN_STORE_CONFLICT`) when it disagrees with what it was presenting.

Two of the three triggers are `BEFORE UPDATE`, and the store only ever inserts, so on the live
write path they never fire. They cover the other writer — one that edits a stored row rather than
re-presenting it:

- `source_versions_digest_immutable` (update): a `source_version_id` keeps one digest and one
  object key for ever.
- `source_representations_original_immutable` (update): an `original` representation is never
  rewritten.
- `source_representations_lineage_resolves` (**insert and update**): a derived representation names
  parents that exist under the same source version. This is the one that fires on the live path.

The first pass said "three triggers make the invariants real under concurrency … only the database
sees both". That was an overclaim; it is retracted here as it was in the SQL header.

### The backfill, and why it fills only one table

The backfill is guarded by `to_regclass('public.documents')` and is a no-op wherever `0001` was not
applied — which, per §1, is the live project. Where `documents` does exist it inserts `sources`
rows with `on conflict (source_id) do nothing`.

It does **not** insert `source_versions` or `source_representations`, and that is deliberate:

- `documents` has no byte length. `SourceVersion.byteLength` is a required number, and a
  backfilled row would either carry a fabricated one or violate its own `check (byte_length >= 1)`.
- `documents.source_sha256` is the **pre-CDR** digest while `sanitization_proofs.immutable_object_key`
  is the **post-CDR** object. Pairing them would record a digest for bytes that key does not hold.

Versions and representations are recorded at observation time instead, where both the digest and
the byte length are known.

---

## 6. The recording seam

`nextjs/lib/source-domain-store.ts` has two halves. `projectSourceLedger` is pure: it turns an
observation into the three records, derives every identifier deterministically, and refuses a chain
it cannot audit. `recordSourceLedger` reads the stored version first, refuses a second digest for a
version that is already bound, and then inserts with `Prefer: resolution=ignore-duplicates` —
never `merge-duplicates`, because a merge here is a stored digest being overwritten by whatever a
later caller believed.

An ignored duplicate answers `201` exactly like a fresh insert, so every insert reads back the row
that was actually kept and compares it column by column. A key that is already taken by a row
saying something else — a source id re-claimed for a second tenant, a derived artifact re-presented
at a second digest — is `SOURCE_DOMAIN_STORE_CONFLICT`, never `recorded`. Nothing else would catch
it: both immutability triggers in `0049` fire on `UPDATE`, and this path only ever inserts.

**Nothing calls it on the live path yet, and that is the seam this lane reports rather than
crosses.** Recording from inside `runCollectionCompile` means carrying representations into the
request to the deployed Python core, which is §24 receipt-v2 work after lanes C and E exist, and
contract §7 R-2 defers it.

The write point it should attach to, when that work is scheduled, is the CDR worker's receipt
write (`quarantine-sidecar/foundation-cdr-worker/src/sanitize.ts:194`), because
`tavonel.cdr_receipt.v1` already carries almost the whole observation:

| Ledger field | Source | Status |
|---|---|---|
| `sourceKey` → original `objectKey` | cdr-receipt | present |
| `inputSha256` → version `contentSha256` | cdr-receipt | present |
| `immutableKey` → normalized `objectKey` | cdr-receipt | present |
| `outputSha256` → normalized `contentSha256` | cdr-receipt | present |
| `provider` → normalized `providerId`/`providerRevision` | cdr-receipt (`TAVONEL_CDR_PROVIDER`) | present, one string for two fields |
| `occurredAt` → `observedAt` | cdr-receipt | present |
| version `byteLength` | **not in the receipt** | `foundation_intake_admissions.requested_bytes`, or an R2 `HEAD` on the quarantine key |
| ocr `contentSha256` | **nowhere** | the digest of `ocr.json` is not recorded by anything today |
| ocr `providerRevision` | GPU release digest | recorded in the OCR path, not in the CDR receipt |

Two of those are genuine gaps and neither may be filled with a placeholder. Until they are, a
caller can record the version plus the `original` and `normalized` representations, and must leave
`ocr` out rather than record an artifact whose digest nobody computed.

---

## 7. What this lane did not do

- **No change to the live compile wire.** `collection-compiler.ts:284`, `core-runtime-v2.ts`,
  `collection-compile-run.ts` and `immutable-keys.ts` are untouched (§7 R-2).
- **No field on `RetrievalUnit`.** Its `contentDigest` hashes the whole object; adding a field
  re-hashes every stored unit.
- **No optional `sourceId`/`sourceVersionId` alias on `DocumentMetadata`.** The row-only edit is
  permitted by the contract but not required by anything: `documentToSource` derives both, and a
  field that no writer ever populates is a schema that looks like coverage and provides none.
- **No `document_versions` migration.** §25's `document_version_id → source_version_id` line has no
  left-hand side; that table does not exist in any of the 48 migrations (seam map C-1, confirmed).
- **No tombstone propagation.** The columns exist and `assertSourceCompilable` refuses a tombstoned
  source; nothing yet *writes* a tombstone, and the Google Drive trashed-file gap
  (`connector-oauth-adapters.ts:80`) is lane F's finding, recorded not fixed.
