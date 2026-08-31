# Retrieval Compiler runtime assembly evidence

**Date:** 2026-08-31 KST
**Branch:** `agent/p0-competitive-gap-2026-08-31`
**Commit:** `bba5912`
**Parent:** `cafdd8d` (Wave 2 completion)
**Audit reference:** `TAVONEL_COMPETITIVE_PRODUCT_TECH_GAP_AUDIT_2026-08-31.md` §45 P0 items 3-11

## Result

The Retrieval Compiler is now a running pipeline reachable from the product,
not a set of individually tested modules. Before this work every module Waves
1-2 produced was imported only by its own test file, and `/ask` still answered
from the excerpt-concatenation fallback in `grounded-ask.ts`.

## What was measured before writing anything

Both findings below were established by reading the tree at `cafdd8d`, not
inferred from the audit document.

### Finding 1 — no orchestrator [CURRENT EVIDENCE]

No file under `nextjs/app/` imported any of `retrieval-profile`,
`retrieval-units`, `lexical-search`, `dense-search`, `rank-fusion`,
`structure-search`, `world-gate`, `context-packet` or `generator-adapter`.
Verified by grepping import statements across `app/` and `lib/`: the only
importers were the modules' own `.test.ts` files plus two internal
cross-imports (`embedder-adapter` -> `retrieval-profile`,
`retrieval-runtime-config` -> adapters).

`app/api/collections/[id]/ask/route.ts` at `cafdd8d` imported
`answerGroundedQuestion` from `grounded-ask.ts` and nothing else from the
retrieval stack.

Consequence: the 464 tests passing at `cafdd8d` proved unit contracts. They
did not prove that a retrieval pipeline ran, because none did.

### Finding 2 — no SQL execution path [CURRENT EVIDENCE]

`lexical-search.ts` and `dense-search.ts` return parameterized raw SQL
(`$1..$5`). The repository has no way to execute it:

- `nextjs/package.json` dependency scan for a Postgres driver returned
  `@supabase/supabase-js` only — no `pg`, `postgres`, `drizzle`, `kysely`,
  or `prisma`.
- Every foundation store (`world-store.ts` and peers) reaches the database
  through PostgREST over HTTP via `supabase-admin.ts`.
- No RPC in migrations `0001`-`0022` accepted a SQL string or implemented
  those two queries.

Consequence: both modules were string builders whose output nothing could run.

## What was built

| Artifact | Role |
|---|---|
| `supabase/migrations/0023_retrieval_search_rpc.sql` | Executes exactly the two searches over PostgREST |
| `nextjs/lib/retrieval-store.ts` | Only module in the retrieval path that touches the database |
| `nextjs/lib/retrieval-pipeline.ts` | Read-side orchestrator |
| `nextjs/lib/retrieval-compile.ts` | Write-side orchestrator |
| `nextjs/app/api/collections/[id]/search/route.ts` (+ `/v1` alias) | New evidence-only surface |
| `nextjs/app/api/collections/[id]/ask/route.ts` | Switched to the pipeline, fallback preserved |

### Design decisions [DESIGN DECISION]

- **Two narrow RPCs, not a Postgres client.** Adding a connection-pooled `pg`
  path to a serverless deployment for the benefit of two queries was rejected;
  the RPCs expose those two queries and nothing else. There is deliberately no
  general-purpose "execute this SQL" RPC, and a migration test asserts exactly
  two functions exist.
- **World Gate runs after reranking**, per audit §18. Ranking decides what is
  relevant; the gate decides what is allowed. Gating first would be cheaper but
  would make the rejection trail meaningless, since it would cover units that
  never ranked well enough to be used.
- **Asymmetric degradation.** At query time, a missing embedder or a failed
  reranker degrades to a narrower but real answer and is recorded in
  `degradations`. At compile time the same failure fails the run, because a
  half-embedded index would be silently read by every later query. Security and
  integrity failures fail closed on both sides.
- **Run row written before any unit.** A crash mid-compile leaves a `running`
  run that `findLatestCompletedRun` never selects, so an incomplete index is
  invisible rather than half-used.
- **`/search` separate from `/ask`**, per audit §22, so a consumer that wants
  only evidence pays neither generation cost nor prose parsing.
- **Fallback preserved and named.** `/ask` falls back to the qualified excerpt
  path only when no compiled index exists for the active world. The response
  field `retrievalPath` is `compiled-retrieval-v1` or
  `excerpt-concatenation-fallback`, so the two are never conflated. A database
  outage does not fall back — it returns the error.

## Verification [CURRENT EVIDENCE]

Commands run in `nextjs/` at commit `bba5912`:

```
npx vitest run      ->  85 files, 495 tests passed  (was 82 / 464 at cafdd8d)
npx tsc --noEmit    ->  exit 0, no diagnostics
npx next build      ->  exit 0
```

31 tests added, 0 regressions.

Both new routes are registered in the production build:

```
grep -o '"/api/[^"]*search[^"]*"' .next/routes-manifest.json
  "/api/collections/[id]/search"
  "/api/v1/collections/[id]/search"
```

### Negative proof — these tests can fail

Passing tests alone do not show a test is load-bearing. Five mutations were
applied to the two new orchestrators, each run against the suite, each reverted:

| # | Mutation | Result |
|---|---|---|
| 1 | Bypass the World Gate (`gated.eligible` -> `gateCandidates`) | FAIL — evidence-less unit entered the packet |
| 2 | Disable the query-embedding dimension guard | FAIL — wrong-space vector reached dense search |
| 3 | Downgrade the lexical fail-closed to a degradation | FAIL — answered from nothing on a read outage |
| 4 | Let an embedding failure complete the run | FAIL — 2 tests, including the incompatible/outage distinction |
| 5 | Mark the run completed before units are durable | FAIL — 2 tests, ordering guarantee |

After each revert the suite returned to green.

## Boundaries — what this does NOT establish

- **The 0023 RPC bodies have not been executed against real rows.** Their text
  is asserted by `retrieval-search-rpc-migration.test.ts` and their semantics
  mirror the two builders (which have their own tests), but running them
  requires `supabase db test` with a local Postgres, which is unavailable in
  this environment. A pgTAP fixture is the remaining gate.
- **The orchestrator tests stub `fetch`**, the PostgREST network boundary.
  Everything above that line is production code; nothing below it is proven.
- **No end-to-end run against a live tenant.** No compile run has been executed
  against a promoted world, so no measured Recall@k, nDCG or latency figure
  exists. Audit §40's ablation table (R0-R6) remains unpopulated, and no
  retrieval quality claim is made here.
- **Temporal validity, the authority model and contradiction/held state are
  still not gated on.** They require the bitemporal claim schema the semantic
  compiler has not built; `world-gate.ts` states this in place rather than
  faking a pass/fail. `heldConflicts` is `[]` for the same reason.
- **TableView still compiles to zero units** — the Reader layer has no table
  detection. Reported through `skippedViews`, not silently dropped.

## Audit §45 P0 status after this commit

| # | Item | Status |
|---|---|---|
| 3 | RetrievalProfile | Implemented (Wave 1), now persisted |
| 4 | Section/Claim/Entity/Table views | Implemented; Table empty by design |
| 5 | Postgres FTS + pgvector | Schema 0020/0022 + executable via 0023 |
| 6 | BGE-M3 baseline | Revision-pinned; TEI endpoints configured |
| 7 | RRF | Implemented and now composed |
| 8 | bge reranker | Implemented and now composed |
| 9 | World Gate | Composed; 4 of 8 checks real, rest blocked on §8 |
| 10 | ContextPacket | Returned by both `/search` and `/ask` |
| 11 | Citation-constrained generation | Guard implemented; not yet wired to a generator |

Items 1 (deployment gate), 2 (backup/restore), 12 (model-backed semantic
compiler) and 13 (promote/rollback qualification) are untouched by this commit.

## Incidental finding — developer distribution digests (fixed in `c8e0fae`)

While re-verifying the test-count claim above, `developer-distribution.test.ts`
failed. Investigation showed this was **not** caused by this work: the sha256
pins in `nextjs/public/developer/channel.json` matched no committed state on any
commit checked (`origin/main`, `cafdd8d`, merge base `1cbec4d` — all NO).

Root cause: the repository had no `.gitattributes`, so the distribution assets
were checked out through `core.autocrlf`. The pins were computed from a Windows
(CRLF) working tree; the blobs are LF. Proof: the committed source-agent blob
hashes to `f8d4bbd8…` as LF and to exactly the pinned `75348f29…` when
re-encoded as CRLF.

The assertion therefore passed on a Windows checkout and failed on any LF
checkout, including CI (`ubuntu-latest`, `pnpm test`). Because these files are
served verbatim from tavonel.com and `update-check` verifies downloads against
these pins, a customer fetching a published asset would have computed the LF
digest and seen a mismatch.

Fixed in a separate commit: `.gitattributes` pins the assets (and the SQL
migrations, which tests assert on as exact text) to `eol=lf`, and `channel.json`
now records the real LF digests. No asset content changed, so no version bump.

Verified against the staged post-renormalize blobs — what CI actually checks
out — all three assets contain no CRLF and match their new pins, while all three
old pins fail against those same bytes.

## Next gates

1. Run `supabase db test` against the 0023 RPCs with a pgTAP fixture.
2. Execute one real compile run against a promoted world; record unit and
   embedding counts.
3. Populate the §40 R0-R6 ablation with measured numbers before any retrieval
   quality claim is made anywhere public.
