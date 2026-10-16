# Closed native World commit v1 — DRAFT

Corrective follow-on to frozen patch SHA256
`2a6fcf13349e86f66a245222cd20d187ab9f2f10bd1f5972d289ab1a00359d06`.
The original patch, source overlay, evidence and Library bundle remain unchanged. Apply this
follow-on after that six-path draft. It changes only the committer, owning TypeScript tests,
SQL draft, owning SQL tests and this document; the contract module is unchanged.

Independent review identified reservation expiry missing from the post-verifier SQL decision,
terminal-job fixture timestamps missing, two refusal expectations at the wrong boundary,
and source/job revocation during the last awaited key/provenance checks before reference
release. This follow-on corrects those bounded findings. All production gates remain closed;
PostgreSQL/pgTAP/FK/concurrency remain UNRUN pending actual disposable execution.

This six-path Foundation slice validates and serializes a separate World-purpose commit.
It does not authorize native processing, issue a grant, enable a route, promote a capability,
or publish a World. Independent review and the missing trusted adapters are prerequisites.

The patch base is Foundation `629b7b84fa8fe5e6db9eaa010a941ba42c447a08`, root tree
`11b136438f9421c04b546b829fbcfcb5755237e3`. The earlier candidate-reader/SourceLedger SQL
preimages are identical here; they are inspected design dependencies, not live native APIs.
All six new paths remain absent at the subsequent UI/test-admission head
`66281ea215ff3927663462e48ab523ee1bf21536`; all six inspected helper/SQL dependencies also
remain identical. No rebase is required for those changes. Core stays at
`92d899e73b7fee972bb6b41fe6f0eae87cb33409`; its code, parser and transport are unchanged.
Foundation has no root AGENTS.md or CLAUDE.md at the pinned base.

Only these new repository paths belong to the patch:

1. `nextjs/lib/native-world-reduction-contract.ts`
2. `nextjs/lib/native-world-reduction-commit.ts`
3. `nextjs/lib/native-world-reduction-commit.test.ts`
4. `supabase/drafts/native-world-reduction-commit.sql`
5. `supabase/drafts/tests/native-world-reduction-commit.sql`
6. `docs/integration/NATIVE_WORLD_REDUCTION_COMMIT_V1_DRAFT.md`

The production import graph adds only Node crypto and the already-published, exact-hash
`canonical-json-wire.ts` helper. It does not import the unpublished processing authority,
source reader, two-artifact writer, or job-worker drafts. SQL files remain outside migrations.

## Exact server request and response

There is **no new HTTP endpoint**. The server-only construction contract is:

```ts
createNativeWorldReductionCommitter(services = null).commit(
  context, grantId, manifestBytes, canonicalModelBytes
): Promise<WorldCommitResult>
```

Default construction throws `NATIVE_WORLD_REDUCTION_DISABLED`. All eight trusted callback
methods are mandatory. Callbacks, caller identity, issuer keys and clock come from reviewed
server construction. Request JSON cannot supply them. A `qualified` boolean is an extra field
and is refused. No preparation-only service adapter is reused implicitly.

`context` has exactly seven fields: `tenantId`, `workspaceId`, `principalUserId`, `jobId`,
`authorizationRevision`, `collectionId`, `documentIds`. Tenant equals the pilot workspace;
principal and 1–16 unique document IDs are canonical lowercase UUIDs. Job IDs are
`cjob-` plus 32 lowercase hex digits. Revision is a positive safe integer. Collection identity
is `collection-` plus the first 32 hex digits of SHA256 of UTF-8
`native-v1\n<workspace>\n<sorted UUIDs joined by newline>`; the committer snapshots and sorts
the document IDs before awaiting. Global collection mode is outside this contract.

The atomic writer receives **exactly nine fields**:

```ts
{
  schemaVersion: "tavonel.native_world_reduction_commit.v1",
  context, grantId, worldReplayBinding,
  inputWorkSha256, outputBindingSha256,
  manifestWire, manifestRawSha256, artifactRefs
}
```

`manifestWire` is the original Core canonical UTF-8 JSON plus one LF. Its byte digest is
`manifestRawSha256`. It is not JSONB-reserialized. `artifactRefs` has exactly three entries,
in order: `native_facts`, `full_cir_package`, `canonical_knowledge_model`. Each stored reference
has exactly `artifactId`, `kind`, `mediaType`, `byteLength`, `sha256`, `objectKey`; media type is
`application/json`, ID is `<kind>_<64-hex-byte-digest>`. These are content references, not a
second table parser or a geometry-bearing OCR response.

The response has **exactly five fields**:

```ts
{
  schemaVersion: "tavonel.native_world_reduction_commit.v1",
  writeStatus: "written" | "exists",
  worldStateId, manifestRawSha256, artifactRefs
}
```

The committer checks the complete response against its immutable input and returns a frozen
result. A denial throws; it never releases a successful reference result. A denial after the
transaction committed can leave an unreleased metadata row. Retrying requires all current
checks again. Error messages identify the admission, scope, signature, byte, expiry, staging,
verification or replay boundary; they do not constitute permission to retry a failed job.

## Separate signed World authority

The resolved envelope has exactly `claims` and `issuerSignature`. The claim object has
exactly these 25 fields:

```text
schemaVersion purpose grantId issuerId issuerKeyId callerId policySha256 evidenceSha256
tenantId workspaceId principalUserId jobId authorizationRevision collectionId
preparationGrantId preparationJobId preparationReplayBinding worldReplayBinding
canonicalRequestSha256 coreReleaseDigest projectionVersion sources inputArtifacts
issuedAt expiresAt
```

Schema is `tavonel.native_world_reduction_authority.v1`, purpose is
`native_world_reduction`, projection is `tavonel.native_cell_observation_world.refs.v1`.
The new grant ID and job must differ from the historical preparation grant and job. A current
authorized reduction job is required. A failed historical preparation job may remain
historical evidence; failed settlement, intake permission or a prepared artifact is never
World-purpose permission. The provenance verifier must enforce that policy explicitly.

Preparation replay has namespace `native-work-<32 hex>`. World replay has its own namespace
`native-world-work-<32 hex>`. Signed sources have exactly `nativeId`, `sourceId`,
`sourceVersionId`, `contentSha256`, `cirSha256`, `processingReceiptId`. Their complete unique
native-ID set equals the context documents, sorted by Core source ID. Core source/version
identities are recomputed with `akc.identity.v1`, `foundation-r2`, native UUID and content
digest. The SQL capture maps these hashed Core identities to the existing Foundation UUID
and UUID/content-hash version identities; it never conflates the two identity schemes.

`inputArtifacts` is the already-prepared facts/package pair, with authoritative storage keys.
Issuer differs from caller. Key resolution must establish a current approved World issuer
and purpose-specific key; an arbitrary valid HMAC key is insufficient qualification.
Signature is `sha256:` plus HMAC-SHA256 hex over:

```text
native_world_reduction\n<canonical claim JSON, no terminal LF>
```

Canonical typed headers use Unicode code-point key order, UTF-8 strings and safe integer
numbers. Issuance/expires times are real UTC ISO timestamps, with at most millisecond
precision; expiry is checked with the trusted clock after every awaited verification step.
Every checkpoint revalidates current source/job authority after grant/key/provenance awaits
and before its final clock decision. The final `after_commit` check can therefore refuse
reference release after cancellation, epoch change or ACL revocation during those waits.
These are point-in-time validations, not leases; a later change after the final decision is
not prevented or promised atomic across independent stores by this service contract.
The repository envelope is admitted with a 32 KiB budget, node/depth limits and a recursively
frozen snapshot before signature/key/provenance awaits. The entire verified envelope is
pinned across later checks; even another correctly signed envelope cannot silently replace it.

Core manifest source set, canonical request digest, release digest, projection, scope and
prepared references must match the grant exactly. The mandatory `verifyCoreArtifacts`
callback must run published Core `verify_native_manifest` over the manifest and **all three
actual blobs**, including complete reprojection and native CIR/table validation. Hash/shape
checks alone do not implement this callback. Python number spellings in manifest validation
are preserved by the wire helper, including `1.0`; floating-point normalization is avoided.

## Storage, limits and bindings

The facts/package references stay at their existing create-once preparation keys:

```text
immutable/<tenant>/<workspace>/native-preparations/nprep_<request SHA hex>/<artifact SHA hex>/<kind>.json
```

Only the model is staged by this service, at:

```text
immutable/<tenant>/<workspace>/native-world-reductions/<worldStateId>/<model SHA hex>/canonical_knowledge_model.json
```

Staging is create-once with exact byte equality on an existing object. It provides no reader
visibility or permission. Failure before metadata commit may leave a private immutable
staged object; reviewed retention/cleanup and authenticated reference-release adapters are
still required. All blobs are checked by actual UTF-8 bytes, SHA256 and declared length.
Buffers are rehashed after Core/staging awaits; staging references and the full transaction
request are frozen. Full CIR, sheet metadata, cells, identities, values and original native
locators remain inside the original facts/package bytes. No PDF bbox is synthesized; PDF
validation and OCR callers remain untouched.

Limits remain: 32 KiB manifest/envelope, 32 MiB per facts/package/model blob, 1–16 documents,
Core's existing cell/package/parser limits. SQL admits at most 128 KiB request metadata,
captures at most 256 KiB metadata, and bounds representation graphs to 128 rows and 32
parents per source version. The capture may refuse a valid large multi-document metadata
set; this slice does not raise an existing limit to admit it. No raw workbook formula, macro
or external-link execution is added.

The separate input-work digest hashes the schema-domain plus canonical JSON of exactly:
`purpose`, `context`, `grantId`, `worldReplayBinding`, `canonicalRequestSha256`, `sources`,
`inputArtifacts`, `coreReleaseDigest`, `projectionVersion`. Output binding hashes the same
schema-domain plus canonical JSON of exactly `manifestRawSha256`, `artifactRefs`. Domain is
`tavonel.native_world_reduction_commit.v1\n`. Raw artifact digests are never hashes of a parsed
JSON approximation. SQL's restricted header serializer is only for these typed small
headers; it is not used to canonicalize CIR, facts, model or signed processing receipts.

## Atomic database draft and closed prerequisites

The draft creates separate `foundation_native_world_grants` and
`foundation_native_world_commits` tables. RLS is enabled; PUBLIC/anon/authenticated/service
roles get no table or function privileges. Proposed grants cannot be promoted by an update:
identities are immutable and only monotonic revocation is permitted. There is no issuance
API, key store, grant seed or native route in this patch.

The commit RPC has a hard-coded FALSE gate and an empty search path. It requires READ
COMMITTED, a bounded public lock timeout and the exact six-argument current job authorizer.
Advisory lock order follows the existing approval-workspace protocol, then **all sorted
document deletion locks**, workspace intake, and workspace legal hold. Row locks are ordered
membership → fresh job → sorted sources → World grant → preparation parent → qualification
→ intake approval → sorted members → versions → complete bounded representations → files
→ reservations → admissions. Parent/version/job `FOR UPDATE` prevents FK KEY SHARE child
inserts from completing during the transaction. This protocol is not concurrency-qualified
merely because it is specified; competing writers/revokers and actual races still need review.

One fresh post-wait command captures the full source/member/qualification/approval/current
job and member sets. Bound processing/security receipts are captured with actual full
SourceLedger representation graphs. The current new job must be nonterminal, document-batch,
direct-upload, same principal/epoch, exact whole document set and derived collection. Existing
source tombstones, connector bindings and pinned connector-job authority refuse this slice.
Preparation reservation pins must be `reserved` or `settled`; released, expired or operator
review states refuse this World slice. This narrows its admission without changing existing
billing policy, charging, settlement or the historical candidate reader.
`reservationExpiresAt` is captured from the same locked full reservation set. At the final
post-verifier `decision_time`, each reserved pin must satisfy expiry strictly greater than
that clock, matching the existing `assert_foundation_intake_compile_set` policy in exact
migration `20261003120000_intake_approval_budget_invariants.sql` (blob
`009e40e1705527048f38399bc0d21bcfdcb184cf`). A reached deadline raises
`NATIVE_WORLD_RESERVATION_EXPIRED` before any commit insert. A settled pin retains the
existing policy: its historical deadline does not refuse the work. This check reads captured
JSON only; it does not requery mutable tables after the final decision clock.
Preparation/source/security/provenance pins cannot be inferred from a normalized PDF key.

The following exact **void/throwing trusted database verifier is deliberately missing**:

```text
public.verify_foundation_native_world_commit_v1(text,text,jsonb,jsonb)
  (claimsWire, issuerSignature, capturedCurrentMetadata, commitRequest) returns void
```

It must authenticate the approved issuer/policy/evidence, current independently reviewed
producer and security receipts/keys, complete captured SourceLedger graphs, and the actual
Core three-blob verification/output binding. A reviewed persisted signed verification
attestation/transaction protocol may be needed; neither an app-side boolean nor a previously
verified preparation receipt supplies that property. This patch does not implement, install
or grant that verifier. Missing verifier refuses even a private gate-open copy. Its revocation
protocol must be part of the same transaction's authority before opening the gate.

Decision time is sampled after lock waits, capture and verifier completion. Expired/revoked
World, preparation or qualification authority refuses. An insert stores **one whole immutable
row containing manifest wire, exactly three refs, input-work/output bindings and replay**.
Uniqueness is `(workspace, reduction job, World replay)` plus grant ID. On conflict, only the
identical complete request returns `exists`; changed input/output/grant work refuses. There
is no call to the old two-artifact writer and no separate replay write to strand on failure.

## Evidence and remaining integration

The owning TypeScript tests include parser-derived normal, merged, Unicode, zero, duplicate
header and locator goldens. They exercise default closure, exact shapes, scope/epoch/source
identity/release/profile, signatures, missing provenance, fresh authority/clock after every
await, byte limits/tampering, Core rejection propagation, immutable staging, atomic failure,
three-ref results and same/conflicting replay. Trusted callbacks/transaction storage in these
units are test doubles, not production qualification or PostgreSQL concurrency proof.
Goldens were independently produced in memory and checked by published Core's full verifier
and locator resolver using existing runtimes. No parser, workbook or dependency copy is added.
Frozen predecessor results: **71/71 Vitest cases passed**, strict no-emit TypeScript with unused
checks passed for production and owning tests (170 source/dependency files), and **6/6 tiny
parser-derived goldens passed actual Core verification/resolution**. The initial test run had
62/63 passing with a Unicode assertion failure; it was corrected to assert the existing
parser's actual `  e\u0301 한글  ` cell value. Exact Core fixture/source preimages (17) were
authenticated-API/hash verified at `92d899`; unrelated Core suites/builds were not repeated.
Corrective follow-on results: **77/77 Vitest cases passed**, including six explicitly deferred
key/provenance waits covering cancellation, epoch and ACL revocation after metadata commit.
Strict TypeScript/unused checks also passed (170 files). SQL syntax/pgTAP/concurrency are
still UNRUN; the new expiry fixtures are specifications, not passing execution evidence.

The SQL owning file provides rollback pgTAP cases plus concrete setup/holder/contender/assert
roles for grant/qualification revocation, membership epoch, source deletion, same/changed
replay, and a genuinely new native-member PK reaching real parent FKs. Controller-held
advisory barriers and `pg_blocking_pids`/`pg_locks` evidence establish actual waits; no sleep
stands in for a race. Only a private owner-only INVOKER copy gets a test gate and synthetic
trust double. Public gate/privileges remain closed. The FK scenario also checks rejection of
the complete newly prepared file set; it does not claim successful third-file reduction.
Correction fixtures cover a reserved pin expired before entry and the settled historical
expiry case. A separate `reservation_expiry` case arms a synthetic paid reservation, enters
the private verifier while its real deadline is still future, and blocks on the controller's
advisory barrier until that captured server deadline is reached. Early release or delayed
entry produces distinct fixture errors. The controller must record actual granted readiness,
blocking PID and deadline observations before releasing its lock; no fake clock or sleep
substitutes for that wait. The two failed-job fixture mutations set `settled_at` to satisfy
the canonical terminal-job constraint. Failed job/deleted source tests expect the actual
fresh-capture `NATIVE_WORLD_CURRENT_SCOPE_INVALID` refusal, preserving the denial.

**PostgreSQL syntax, pgTAP, privileges, FK waits and cross-session concurrency are UNRUN.**
This environment has no available psql client, pglast/sqlparse parser or psycopg driver, and
no live database was called. Do not convert fixtures into qualification evidence until
Root's disposable harness actually records passing sessions and independent review.

Core's prior BEA manifest evidence is unchanged, not rerun for this Foundation-only patch:
21 sheets/13,006 cells, facts 25,769,061 B, full CIR package 7,741,306 B, compact model
30,948,366 B and manifest 2,536 B. The separate artifacts total 64,458,733 B; they were
never claimed to fit one 32 MiB inline package. End-to-end BEA through this committer/database
is UNRUN. New acceptance does not come from those public-workbook observations.

Remaining integration: approved World-purpose issuance/key/provenance policy, production
Core-verifier and immutable storage adapters, database verifier/atomic transaction protocol
qualification, revocation/deletion/retention and authenticated reference-release handling,
fresh job enqueue/worker wiring, and a separately reviewed gate change. None is activated by
this slice. No provider calls, customer data, publication, migration application, credentials,
capability claims or promotion are part of the deliverable.
